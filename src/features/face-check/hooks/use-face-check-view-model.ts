"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Employee, FaceMatchResult } from "@/entities/employee";
import { 
  FACE_MATCH_THRESHOLD, 
  ACCURACY_CONFIG,
  initializeFaceDetection,
  detectMultipleFaces,
  matchMultipleFaces,
  distanceToSimilarity,
  type DetectedFace,
} from "@/shared/lib/face-embedding";
import type { EmployeeRepository } from "@/shared/repositories/employee-repository";

export type FaceCheckPhase =
  | "idle"
  | "loading-employees"
  | "loading-models"
  | "camera-initializing"
  | "camera-ready"
  | "detecting"
  | "matched"
  | "cooldown"
  | "error";

export interface CheckInLogEntry {
  id: string;
  employeeId: string;
  employeeName: string;
  avatarUrl?: string;
  timestamp: Date;
  similarity: number;
  snapshotUrl?: string;
}

interface UseFaceCheckViewModelOptions {
  repository: EmployeeRepository;
  autoStart?: boolean;
}

const DETECTION_INTERVAL_MS = 50; // Very fast detection ~20 fps for motion tracking
const CHECK_IN_COOLDOWN_MS = 300;
const SAME_PERSON_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

export const useFaceCheckViewModel = ({
  repository,
  autoStart = true,
}: UseFaceCheckViewModelOptions) => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [detectedEmployee, setDetectedEmployee] = useState<Employee | null>(null);
  const [phase, setPhase] = useState<FaceCheckPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [matchResult, setMatchResult] = useState<FaceMatchResult | null>(null);
  const [isLoadingEmployees, setIsLoadingEmployees] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectedFaces, setDetectedFaces] = useState<DetectedFace[]>([]);
  const [modelsReady, setModelsReady] = useState(false);
  const [checkInLogs, setCheckInLogs] = useState<CheckInLogEntry[]>([]);
  
  // Track consecutive matches per person
  const consecutiveMatchesRef = useRef<Map<string, number>>(new Map());
  const [matchInCooldown, setMatchInCooldown] = useState(false);
  const [consecutiveMatchCount, setConsecutiveMatchCount] = useState(0);
  const [livenessScore] = useState(0.5); // Simplified - always pass

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const recentCheckIns = useRef<Map<string, number>>(new Map());
  const initStartedRef = useRef(false);
  const isDetectionRunningRef = useRef(false);

  // Stop detection
  const stopDetection = useCallback(() => {
    isDetectionRunningRef.current = false;
    if (detectionIntervalRef.current) {
      clearTimeout(detectionIntervalRef.current);
      detectionIntervalRef.current = null;
    }
    setIsDetecting(false);
    setDetectedFaces([]);
    consecutiveMatchesRef.current.clear();
  }, []);

  // Stop camera
  const stopCamera = useCallback(() => {
    stopDetection();
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, [stopDetection]);

  useEffect(() => stopCamera, [stopCamera]);

  // Check cooldown
  const isInCooldown = useCallback((employeeId: string): boolean => {
    const now = Date.now();
    const lastCheckIn = recentCheckIns.current.get(employeeId);
    if (lastCheckIn && now - lastCheckIn < SAME_PERSON_COOLDOWN_MS) return true;
    
    const dbCheckIn = checkInLogs.find(log => log.employeeId === employeeId);
    if (dbCheckIn && now - dbCheckIn.timestamp.getTime() < SAME_PERSON_COOLDOWN_MS) return true;
    
    return false;
  }, [checkInLogs]);

  // Add check-in log
  const addCheckInLog = useCallback((employee: Employee, similarity: number, snapshotUrl?: string) => {
    const entry: CheckInLogEntry = {
      id: `log_${Date.now()}`,
      employeeId: employee.id,
      employeeName: employee.fullName,
      avatarUrl: employee.avatarUrl,
      timestamp: new Date(),
      similarity,
      snapshotUrl,
    };
    setCheckInLogs(prev => [entry, ...prev].slice(0, 50));
  }, []);

  // Perform check-in
  const performCheckIn = useCallback(async (
    employee: Employee, 
    similarity: number
  ): Promise<boolean> => {
    try {
      await repository.recordCheckIn({
        employeeId: employee.id,
        similarityScore: similarity,
        isMatch: true,
        capturedAt: new Date().toISOString(),
      });
      addCheckInLog(employee, similarity);
      recentCheckIns.current.set(employee.id, Date.now());
      return true;
    } catch (err) {
      console.error("Check-in failed:", err);
      return false;
    }
  }, [repository, addCheckInLog]);

  // Main detection loop - MULTIPLE FACES
  const runDetection = useCallback(async () => {
    if (!videoRef.current || !isDetectionRunningRef.current) return;

    try {
      // Detect all faces
      const faces = await detectMultipleFaces(videoRef.current);
      
      if (faces.length === 0) {
        setDetectedFaces([]);
        consecutiveMatchesRef.current.clear();
        setConsecutiveMatchCount(0);
        return;
      }

      // Get enrolled employees
      const enrolledEmployees = employees.filter(
        emp => emp.embeddings?.entries?.length || emp.embedding?.vector?.length
      );

      // Match faces to employees
      const matchedFaces = matchMultipleFaces(
        faces,
        enrolledEmployees.map(emp => ({
          id: emp.id,
          name: emp.fullName,
          embeddings: emp.embeddings,
          embedding: emp.embedding,
        })),
        FACE_MATCH_THRESHOLD
      );

      setDetectedFaces(matchedFaces);

      // Check for check-ins (any face that matches and passes consecutive check)
      for (const face of matchedFaces) {
        if (!face.employeeId || !face.employeeName) continue;
        
        // Skip if in cooldown
        if (isInCooldown(face.employeeId)) {
          setMatchInCooldown(true);
          continue;
        }
        setMatchInCooldown(false);

        // Track consecutive matches
        const currentCount = consecutiveMatchesRef.current.get(face.employeeId) || 0;
        consecutiveMatchesRef.current.set(face.employeeId, currentCount + 1);
        
        // Update UI for the best match
        setConsecutiveMatchCount(currentCount + 1);

        // Check if enough consecutive matches
        if (currentCount + 1 >= ACCURACY_CONFIG.CONSECUTIVE_MATCHES_REQUIRED) {
          const employee = employees.find(e => e.id === face.employeeId);
          if (employee) {
            // Success! Perform check-in
            stopDetection();
            setDetectedEmployee(employee);
            setPhase("matched");
            
            const similarity = face.matchScore ?? distanceToSimilarity(face.distance ?? 0);
            setMatchResult({
              employeeId: employee.id,
              capturedAt: new Date().toISOString(),
              snapshotDataUrl: "",
              score: similarity,
              threshold: FACE_MATCH_THRESHOLD,
              status: "matched",
              message: `${employee.fullName} เช็คชื่อสำเร็จ!`,
            });

            await performCheckIn(employee, similarity);

            // Resume after cooldown
            setTimeout(() => {
              setPhase("detecting");
              setDetectedEmployee(null);
              setMatchResult(null);
              consecutiveMatchesRef.current.clear();
              setConsecutiveMatchCount(0);
              
              if (streamRef.current && videoRef.current) {
                setIsDetecting(true);
                isDetectionRunningRef.current = true;
                scheduleNextDetection();
              }
            }, CHECK_IN_COOLDOWN_MS);
            
            return;
          }
        }
      }

      // Clear consecutive counts for faces no longer detected
      const detectedIds = new Set(matchedFaces.filter(f => f.employeeId).map(f => f.employeeId));
      for (const [id] of consecutiveMatchesRef.current) {
        if (!detectedIds.has(id)) {
          consecutiveMatchesRef.current.delete(id);
        }
      }
    } catch (err) {
      console.error("Detection error:", err);
    }
  }, [employees, isInCooldown, stopDetection, performCheckIn]);

  // Schedule next detection - continuous loop
  const scheduleNextDetection = useCallback(() => {
    if (!isDetectionRunningRef.current) return;
    
    detectionIntervalRef.current = setTimeout(() => {
      if (!isDetectionRunningRef.current) return;
      // Run detection without waiting - fire and forget for speed
      runDetection();
      scheduleNextDetection();
    }, DETECTION_INTERVAL_MS);
  }, [runDetection]);

  // Start detection
  const startDetection = useCallback(() => {
    if (!streamRef.current || !videoRef.current) {
      setError("กรุณาเริ่มกล้องก่อน");
      return;
    }

    const enrolledCount = employees.filter(
      emp => emp.embeddings?.entries?.length || emp.embedding?.vector?.length
    ).length;
    
    if (enrolledCount === 0) {
      setError("ไม่มีพนักงานที่ลงทะเบียนใบหน้า");
      return;
    }

    setError(null);
    setIsDetecting(true);
    setPhase("detecting");
    setDetectedEmployee(null);
    setMatchResult(null);
    isDetectionRunningRef.current = true;
    consecutiveMatchesRef.current.clear();

    runDetection().then(() => scheduleNextDetection());
  }, [employees, runDetection, scheduleNextDetection]);

  // Initialize camera
  const initializeCamera = useCallback(async () => {
    if (!navigator?.mediaDevices?.getUserMedia) {
      setError("อุปกรณ์ไม่รองรับกล้อง");
      setPhase("error");
      return false;
    }

    if (streamRef.current && videoRef.current && videoRef.current.readyState >= 2) {
      setPhase("camera-ready");
      return true;
    }

    setPhase("camera-initializing");
    setError(null);

    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      streamRef.current = stream;
      setPhase("camera-ready");
      return true;
    } catch (err) {
      setPhase("error");
      setError("ไม่สามารถเปิดกล้องได้");
      return false;
    }
  }, []);

  // Load models
  useEffect(() => {
    const loadModels = async () => {
      setPhase("loading-models");
      const loaded = await initializeFaceDetection();
      setModelsReady(loaded);
    };
    loadModels();
  }, []);

  // Load employees
  useEffect(() => {
    const loadEmployees = async () => {
      setIsLoadingEmployees(true);
      setPhase("loading-employees");
      try {
        const data = await repository.listEmployees();
        setEmployees(data);
        
        const events = await repository.listCheckInEvents(50);
        const logs: CheckInLogEntry[] = events.map(event => {
          const employee = data.find(e => e.id === event.employeeId);
          return {
            id: event.id,
            employeeId: event.employeeId,
            employeeName: employee?.fullName ?? "Unknown",
            avatarUrl: employee?.avatarUrl,
            timestamp: new Date(event.capturedAt),
            similarity: event.similarityScore,
            snapshotUrl: event.snapshot,
          };
        });
        setCheckInLogs(logs);
        setPhase("idle");
      } catch (err) {
        setError("ไม่สามารถโหลดข้อมูลได้");
        setPhase("error");
      } finally {
        setIsLoadingEmployees(false);
      }
    };

    loadEmployees();
    const unsubscribe = repository.subscribe(setEmployees);
    return () => unsubscribe();
  }, [repository]);

  // Auto-start
  useEffect(() => {
    if (!autoStart || initStartedRef.current) return;
    if (!modelsReady || isLoadingEmployees || phase !== "idle") return;

    const enrolledCount = employees.filter(
      emp => emp.embeddings?.entries?.length || emp.embedding?.vector?.length
    ).length;

    const autoInit = async () => {
      initStartedRef.current = true;
      const cameraStarted = await initializeCamera();
      if (cameraStarted && enrolledCount > 0) {
        setTimeout(startDetection, 500);
      }
    };

    autoInit();
  }, [autoStart, modelsReady, isLoadingEmployees, phase, employees, initializeCamera, startDetection]);

  const getVideoDimensions = useCallback(() => {
    if (!videoRef.current) return { width: 640, height: 480 };
    return {
      width: videoRef.current.videoWidth || 640,
      height: videoRef.current.videoHeight || 480,
    };
  }, []);

  return useMemo(() => ({
    employees,
    detectedEmployee,
    repositoryKind: repository.kind,
    status: {
      phase,
      isLoadingEmployees,
      isCameraSupported: typeof navigator !== "undefined" && !!navigator?.mediaDevices?.getUserMedia,
      isDetecting,
      modelsReady,
      livenessScore,
      consecutiveMatchCount,
      matchInCooldown,
    },
    videoRef,
    matchResult,
    snapshot: null,
    error,
    detectedFaces,
    checkInLogs,
    getVideoDimensions,
    multiAngleState: null,
    lastQuality: null,
    actions: {
      initializeCamera,
      startDetection,
      stopDetection,
      stopCamera,
      resetSession: () => {
        stopDetection();
        setMatchResult(null);
        setDetectedEmployee(null);
        setPhase(streamRef.current ? "camera-ready" : "idle");
        setError(null);
        setDetectedFaces([]);
      },
      // Stubs for compatibility
      captureForEnrollment: async () => false,
      enrollFromLastCapture: async () => false,
      startMultiAngleCapture: () => {},
      captureMultiAngle: async () => ({ success: false, message: "" }),
      cancelMultiAngleCapture: () => {},
      completeMultiAngleEnrollment: async () => false,
      getAngleGuidance: () => "",
    },
  }), [
    employees, detectedEmployee, repository.kind, phase, isLoadingEmployees,
    isDetecting, modelsReady, livenessScore, consecutiveMatchCount, matchInCooldown,
    matchResult, error, detectedFaces, checkInLogs, getVideoDimensions,
    initializeCamera, startDetection, stopDetection, stopCamera,
  ]);
};
