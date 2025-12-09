"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Employee,
  FaceEmbedding,
  FaceMatchResult,
} from "@/entities/employee";
import { 
  FACE_MATCH_THRESHOLD, 
  captureEmbeddingFromVideoAsync,
  detectFacesInVideo,
  compareFaces,
  distanceToSimilarity,
  initializeFaceDetection,
  type DetectedFace,
} from "@/shared/lib/face-embedding";
import { getLivenessDetector, resetLivenessDetector } from "@/shared/lib/liveness-detection";
import type { EmployeeRepository } from "@/shared/repositories/employee-repository";

export type FaceCheckPhase =
  | "idle"
  | "loading-employees"
  | "loading-models"
  | "camera-initializing"
  | "camera-ready"
  | "detecting"
  | "capturing"
  | "verifying"
  | "matched"
  | "cooldown"
  | "error";

// Check-in log entry
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
  autoStart?: boolean; // Auto-start camera and detection
}

const DETECTION_INTERVAL_MS = 400; // Fast scanning with AI detection
const FACE_OVERLAY_INTERVAL_MS = 100; // Face overlay updates
const CHECK_IN_COOLDOWN_MS = 5000; // 5 second cooldown after check-in
const SAME_PERSON_COOLDOWN_MS = 30000; // 30 second cooldown for same person

interface EmployeeMatch {
  employee: Employee;
  distance: number;
  similarity: number;
}

export const useFaceCheckViewModel = ({
  repository,
  autoStart = true, // Default to auto-start
}: UseFaceCheckViewModelOptions) => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [detectedEmployee, setDetectedEmployee] = useState<Employee | null>(null);
  const [phase, setPhase] = useState<FaceCheckPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [matchResult, setMatchResult] = useState<FaceMatchResult | null>(null);
  const [isCameraSupported, setIsCameraSupported] = useState(false);
  const [isLoadingEmployees, setIsLoadingEmployees] = useState(false);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectedFaces, setDetectedFaces] = useState<DetectedFace[]>([]);
  const [modelsReady, setModelsReady] = useState(false);
  const [checkInLogs, setCheckInLogs] = useState<CheckInLogEntry[]>([]);
  const [livenessScore, setLivenessScore] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const latestEmbeddingRef = useRef<number[] | null>(null);
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const faceOverlayIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const cooldownTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const recentCheckIns = useRef<Map<string, number>>(new Map()); // employeeId -> timestamp
  const initStartedRef = useRef(false);

  useEffect(() => {
    setIsCameraSupported(Boolean(navigator?.mediaDevices?.getUserMedia));
  }, []);

  // Stop detection
  const stopDetection = useCallback(() => {
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
      detectionIntervalRef.current = null;
    }
    if (faceOverlayIntervalRef.current) {
      clearInterval(faceOverlayIntervalRef.current);
      faceOverlayIntervalRef.current = null;
    }
    setIsDetecting(false);
    setDetectedFaces([]);
    resetLivenessDetector();
  }, []);

  // Stop camera
  const stopCamera = useCallback(() => {
    stopDetection();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, [stopDetection]);

  // Cleanup on unmount
  useEffect(() => stopCamera, [stopCamera]);

  // Find the best matching employee
  const findBestMatch = useCallback((capturedEmbedding: number[]): EmployeeMatch | null => {
    if (!capturedEmbedding || capturedEmbedding.length === 0) {
      return null;
    }

    const enrolledEmployees = employees.filter(
      (emp) => emp.embedding?.vector?.length
    );

    if (enrolledEmployees.length === 0) {
      return null;
    }

    let bestMatch: EmployeeMatch | null = null;

    for (const employee of enrolledEmployees) {
      if (!employee.embedding?.vector || employee.embedding.vector.length === 0) continue;

      const distance = compareFaces(capturedEmbedding, employee.embedding.vector);
      const similarity = distanceToSimilarity(distance);

      if (!bestMatch || distance < bestMatch.distance) {
        bestMatch = { employee, distance, similarity };
      }
    }

    return bestMatch;
  }, [employees]);

  // Check if employee is in cooldown
  const isInCooldown = useCallback((employeeId: string): boolean => {
    const lastCheckIn = recentCheckIns.current.get(employeeId);
    if (!lastCheckIn) return false;
    return Date.now() - lastCheckIn < SAME_PERSON_COOLDOWN_MS;
  }, []);

  // Add to check-in log
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
    setCheckInLogs((prev) => [entry, ...prev].slice(0, 50)); // Keep last 50 entries
  }, []);

  // Perform auto check-in (no confirmation needed)
  const performAutoCheckIn = useCallback(async (
    employee: Employee, 
    similarity: number, 
    snapshotDataUrl: string
  ): Promise<boolean> => {
    try {
      // Record check-in
      await repository.recordCheckIn({
        employeeId: employee.id,
        similarityScore: similarity,
        isMatch: true,
        capturedAt: new Date().toISOString(),
        snapshotDataUrl,
      });

      // Add to log
      addCheckInLog(employee, similarity, snapshotDataUrl);

      // Record cooldown for this employee
      recentCheckIns.current.set(employee.id, Date.now());

      return true;
    } catch (err) {
      console.error("Auto check-in failed:", err);
      return false;
    }
  }, [repository, addCheckInLog]);

  // Ref to hold the detection function for cooldown restart
  const autoDetectAndCheckInRef = useRef<(() => Promise<boolean>) | undefined>(undefined);

  // Start detection after cooldown
  const startDetectionAfterCooldown = useCallback(() => {
    if (cooldownTimeoutRef.current) {
      clearTimeout(cooldownTimeoutRef.current);
    }

    cooldownTimeoutRef.current = setTimeout(() => {
      setPhase("detecting");
      setDetectedEmployee(null);
      setMatchResult(null);
      setSnapshot(null);
      resetLivenessDetector();
      
      // Restart detection interval
      if (streamRef.current && videoRef.current && autoDetectAndCheckInRef.current) {
        setIsDetecting(true);
        detectionIntervalRef.current = setInterval(() => {
          void autoDetectAndCheckInRef.current?.();
        }, DETECTION_INTERVAL_MS);
      }
    }, CHECK_IN_COOLDOWN_MS);
  }, []);

  // Auto-detect and auto check-in
  const autoDetectAndCheckIn = useCallback(async (): Promise<boolean> => {
    try {
      if (!videoRef.current || phase === "cooldown") {
        return false;
      }

      const capture = await captureEmbeddingFromVideoAsync(videoRef.current);
      
      if (!capture.faceDetected || capture.embedding.length === 0) {
        setDetectedFaces([]);
        setLivenessScore(0);
        return false;
      }

      // Update liveness detector
      const livenessDetector = getLivenessDetector();
      livenessDetector.addFrame(
        capture.landmarks,
        capture.boundingBox
      );
      const currentLivenessScore = livenessDetector.getLivenessScore();
      setLivenessScore(currentLivenessScore);

      const bestMatch = findBestMatch(capture.embedding);

      // Update face overlay
      if (capture.boundingBox) {
        const showName = bestMatch && bestMatch.distance <= FACE_MATCH_THRESHOLD * 1.5;
        setDetectedFaces([{
          boundingBox: capture.boundingBox,
          confidence: capture.confidence ?? 0.9,
          employeeName: showName ? bestMatch.employee.fullName : undefined,
          matchScore: bestMatch?.similarity,
        }]);
      }

      if (!bestMatch) {
        return false;
      }

      // Check if match meets threshold
      if (bestMatch.distance <= FACE_MATCH_THRESHOLD) {
        // Check liveness (anti-spoofing)
        if (!livenessDetector.isLive()) {
          // Not enough liveness evidence yet, continue scanning
          return false;
        }

        // Check cooldown for this employee
        if (isInCooldown(bestMatch.employee.id)) {
          // Employee already checked in recently
          return false;
        }

        // Match found! Perform auto check-in
        stopDetection();
        
        latestEmbeddingRef.current = capture.embedding;
        setSnapshot(capture.dataUrl);
        setDetectedEmployee(bestMatch.employee);
        setPhase("matched");

        const newResult: FaceMatchResult = {
          employeeId: bestMatch.employee.id,
          capturedAt: new Date().toISOString(),
          snapshotDataUrl: capture.dataUrl,
          score: Number(bestMatch.similarity.toFixed(4)),
          threshold: FACE_MATCH_THRESHOLD,
          status: "matched",
          message: `${bestMatch.employee.fullName} เช็คชื่อสำเร็จ!`,
        };
        setMatchResult(newResult);

        // Auto check-in
        await performAutoCheckIn(bestMatch.employee, bestMatch.similarity, capture.dataUrl);

        // Start cooldown then resume detection
        setPhase("cooldown");
        startDetectionAfterCooldown();

        return true;
      }

      return false;
    } catch {
      return false;
    }
  }, [phase, findBestMatch, isInCooldown, stopDetection, performAutoCheckIn, startDetectionAfterCooldown]);

  // Keep ref updated
  useEffect(() => {
    autoDetectAndCheckInRef.current = autoDetectAndCheckIn;
  }, [autoDetectAndCheckIn]);

  // Start continuous face detection
  const startDetection = useCallback(() => {
    if (!streamRef.current || !videoRef.current) {
      setError("กรุณาเริ่มกล้องก่อนตรวจจับใบหน้า");
      return;
    }

    const enrolledCount = employees.filter((emp) => emp.embedding?.vector?.length).length;
    if (enrolledCount === 0) {
      setError("ไม่มีพนักงานที่ลงทะเบียนใบหน้าไว้");
      return;
    }

    setError(null);
    setIsDetecting(true);
    setPhase("detecting");
    setDetectedEmployee(null);
    setMatchResult(null);
    resetLivenessDetector();

    // Start face overlay updates
    faceOverlayIntervalRef.current = setInterval(() => {
      void detectFacesInVideo(videoRef.current!).then((faces) => {
        if (faces.length > 0) {
          setDetectedFaces((prev) => prev.length > 0 ? prev : faces.map((boundingBox) => ({
            boundingBox,
            confidence: 0.9,
          })));
        }
      });
    }, FACE_OVERLAY_INTERVAL_MS);

    // Start detection loop
    detectionIntervalRef.current = setInterval(() => {
      void autoDetectAndCheckIn();
    }, DETECTION_INTERVAL_MS);

    // Run first detection immediately
    void autoDetectAndCheckIn();
  }, [employees, autoDetectAndCheckIn]);

  // Initialize camera
  const initializeCamera = useCallback(async () => {
    if (!navigator?.mediaDevices?.getUserMedia) {
      setError("อุปกรณ์นี้ไม่รองรับกล้อง");
      setPhase("error");
      return;
    }

    setPhase("camera-initializing");
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 720 },
          height: { ideal: 720 },
        },
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
      setError(
        err instanceof Error
          ? err.message
          : "ไม่สามารถเข้าถึงสตรีมกล้องได้",
      );
      return false;
    }
  }, []);

  // Load models and employees on mount
  useEffect(() => {
    const loadModels = async () => {
      setPhase("loading-models");
      try {
        const loaded = await initializeFaceDetection();
        setModelsReady(loaded);
        if (!loaded) {
          console.warn("Face detection models failed to load");
        }
      } catch (err) {
        console.error("Failed to load face models:", err);
      }
    };
    loadModels();
  }, []);

  useEffect(() => {
    const loadEmployees = async () => {
      setIsLoadingEmployees(true);
      setPhase("loading-employees");
      setError(null);
      try {
        const data = await repository.listEmployees();
        setEmployees(data);
        setPhase("idle");
      } catch (err) {
        setError(err instanceof Error ? err.message : "ไม่สามารถโหลดข้อมูลพนักงานได้");
        setPhase("error");
      } finally {
        setIsLoadingEmployees(false);
      }
    };

    loadEmployees();
  }, [repository]);

  // Auto-start camera and detection when everything is ready
  useEffect(() => {
    if (!autoStart || initStartedRef.current) return;
    if (!modelsReady || isLoadingEmployees) return;
    if (phase !== "idle") return;

    const enrolledCount = employees.filter((emp) => emp.embedding?.vector?.length).length;
    
    const autoInitialize = async () => {
      initStartedRef.current = true;
      const cameraStarted = await initializeCamera();
      if (cameraStarted && enrolledCount > 0) {
        // Small delay to ensure video is playing
        setTimeout(() => {
          startDetection();
        }, 500);
      }
    };

    autoInitialize();
  }, [autoStart, modelsReady, isLoadingEmployees, phase, employees, initializeCamera, startDetection]);

  // Enroll face for a specific employee
  const enrollFromLastCapture = useCallback(async (employeeId: string) => {
    try {
      const employee = employees.find((item) => item.id === employeeId);
      if (!employee) {
        throw new Error("เลือกพนักงานเพื่อลงทะเบียน");
      }

      if (!latestEmbeddingRef.current || !snapshot) {
        throw new Error("กรุณาถ่ายภาพใบหน้าก่อนลงทะเบียน");
      }

      const embedding: FaceEmbedding = {
        version: "faceapi-v1",
        vector: latestEmbeddingRef.current,
        createdAt: new Date().toISOString(),
        source: "camera",
      };

      await repository.upsertEmbedding(employee.id, embedding);
      setEmployees((prev) =>
        prev.map((item) => (item.id === employee.id ? { ...item, embedding } : item)),
      );
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "ไม่สามารถลงทะเบียนข้อมูลใบหน้าได้");
      setPhase("error");
      return false;
    }
  }, [employees, repository, snapshot]);

  // Capture a single frame for enrollment
  const captureForEnrollment = useCallback(async () => {
    try {
      if (!videoRef.current) {
        throw new Error("สตรีมกล้องยังไม่พร้อม");
      }

      setPhase("capturing");
      setError(null);

      const capture = await captureEmbeddingFromVideoAsync(videoRef.current);
      
      if (!capture.faceDetected || capture.embedding.length === 0) {
        throw new Error("ไม่พบใบหน้าในภาพ กรุณาหันหน้าเข้าหากล้อง");
      }

      latestEmbeddingRef.current = capture.embedding;
      setSnapshot(capture.dataUrl);
      setPhase("camera-ready");

      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "ไม่สามารถถ่ายภาพได้");
      setPhase("error");
      return false;
    }
  }, []);

  const resetSession = useCallback(() => {
    stopDetection();
    if (cooldownTimeoutRef.current) {
      clearTimeout(cooldownTimeoutRef.current);
    }
    setMatchResult(null);
    setSnapshot(null);
    setDetectedEmployee(null);
    latestEmbeddingRef.current = null;
    setPhase(streamRef.current ? "camera-ready" : "idle");
    setError(null);
    setDetectedFaces([]);
    setLivenessScore(0);
    resetLivenessDetector();
  }, [stopDetection]);

  // Get video dimensions
  const getVideoDimensions = useCallback(() => {
    if (!videoRef.current) return { width: 640, height: 640 };
    return {
      width: videoRef.current.videoWidth || 640,
      height: videoRef.current.videoHeight || 640,
    };
  }, []);

  return useMemo(
    () => ({
      employees,
      detectedEmployee,
      repositoryKind: repository.kind,
      status: {
        phase,
        isLoadingEmployees,
        isCameraSupported,
        isDetecting,
        modelsReady,
        livenessScore,
      },
      videoRef,
      matchResult,
      snapshot,
      error,
      detectedFaces,
      checkInLogs,
      getVideoDimensions,
      actions: {
        initializeCamera,
        startDetection,
        stopDetection,
        captureForEnrollment,
        enrollFromLastCapture,
        stopCamera,
        resetSession,
      },
    }),
    [
      employees,
      detectedEmployee,
      repository.kind,
      phase,
      isLoadingEmployees,
      isCameraSupported,
      isDetecting,
      modelsReady,
      livenessScore,
      matchResult,
      snapshot,
      error,
      detectedFaces,
      checkInLogs,
      getVideoDimensions,
      initializeCamera,
      startDetection,
      stopDetection,
      captureForEnrollment,
      enrollFromLastCapture,
      stopCamera,
      resetSession,
    ],
  );
};
