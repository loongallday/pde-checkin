"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Employee,
  FaceCheckEventPayload,
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
  | "mismatch"
  | "error";

interface UseFaceCheckViewModelOptions {
  repository: EmployeeRepository;
}

const DETECTION_INTERVAL_MS = 500; // Fast scanning with AI detection
const FACE_OVERLAY_INTERVAL_MS = 150; // Face overlay updates

interface EmployeeMatch {
  employee: Employee;
  distance: number;  // Euclidean distance (lower = better match)
  similarity: number; // Converted to 0-1 scale for display
}

export const useFaceCheckViewModel = ({
  repository,
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

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const latestEmbeddingRef = useRef<number[] | null>(null);
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const faceOverlayIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const [modelsReady, setModelsReady] = useState(false);

  useEffect(() => {
    setIsCameraSupported(Boolean(navigator?.mediaDevices?.getUserMedia));
  }, []);

  // Load face detection models on mount
  useEffect(() => {
    const loadModels = async () => {
      setPhase("loading-models");
      try {
        const loaded = await initializeFaceDetection();
        setModelsReady(loaded);
        if (!loaded) {
          console.warn("Face detection models failed to load - using fallback");
        }
      } catch (err) {
        console.error("Failed to load face models:", err);
      }
      setPhase("idle");
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
  }, []);

  const stopCamera = useCallback(() => {
    stopDetection();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, [stopDetection]);

  useEffect(() => stopCamera, [stopCamera]);

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
    } catch (err) {
      setPhase("error");
      setError(
        err instanceof Error
          ? err.message
          : "ไม่สามารถเข้าถึงสตรีมกล้องได้",
      );
    }
  }, []);

  const buildEventPayload = useCallback(
    (employeeId: string, similarityScore: number, isMatch: boolean, snapshotDataUrl?: string): FaceCheckEventPayload => ({
      employeeId,
      similarityScore,
      isMatch,
      capturedAt: new Date().toISOString(),
      snapshotDataUrl,
    }),
    [],
  );

  // Find the best matching employee from all enrolled employees using euclidean distance
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

      // Use euclidean distance - lower is better
      const distance = compareFaces(capturedEmbedding, employee.embedding.vector);
      const similarity = distanceToSimilarity(distance);

      // Best match has lowest distance
      if (!bestMatch || distance < bestMatch.distance) {
        bestMatch = { employee, distance, similarity };
      }
    }

    return bestMatch;
  }, [employees]);

  // Update face overlay with current detection
  const updateFaceOverlay = useCallback(async () => {
    try {
      if (!videoRef.current) return;
      
      const faces = await detectFacesInVideo(videoRef.current);
      if (faces.length > 0) {
        // Try to match detected face
        const capture = await captureEmbeddingFromVideoAsync(videoRef.current);
        const bestMatch = findBestMatch(capture.embedding);
        
        // Show name if distance is reasonable (within 1.5x threshold)
        const showName = bestMatch && bestMatch.distance <= FACE_MATCH_THRESHOLD * 1.5;
        
        setDetectedFaces(faces.map((boundingBox) => ({
          boundingBox,
          confidence: capture.confidence ?? (capture.faceDetected ? 0.9 : 0.5),
          employeeName: showName ? bestMatch.employee.fullName : undefined,
          matchScore: bestMatch?.similarity,
        })));
      } else {
        setDetectedFaces([]);
      }
    } catch {
      // Silently continue
    }
  }, [findBestMatch]);

  // Auto-detect and verify against all employees
  const autoDetectAndVerify = useCallback(async (): Promise<boolean> => {
    try {
      if (!videoRef.current) {
        return false; // Silently fail during detection loop
      }

      const capture = await captureEmbeddingFromVideoAsync(videoRef.current);
      
      // Skip if no face detected
      if (!capture.faceDetected || capture.embedding.length === 0) {
        setDetectedFaces([]);
        return false;
      }

      const bestMatch = findBestMatch(capture.embedding);

      // Update face overlay with current match info
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
        // No enrolled employees, continue scanning
        return false;
      }

      // Check if distance is below threshold (match found)
      if (bestMatch.distance <= FACE_MATCH_THRESHOLD) {
        // Found a match! Stop detection and show result
        stopDetection();
        
        latestEmbeddingRef.current = capture.embedding;
        setSnapshot(capture.dataUrl);
        setDetectedEmployee(bestMatch.employee);
        setPhase("verifying");

        const isMatch = true;
        const newResult: FaceMatchResult = {
          employeeId: bestMatch.employee.id,
          capturedAt: new Date().toISOString(),
          snapshotDataUrl: capture.dataUrl,
          score: Number(bestMatch.similarity.toFixed(4)),
          threshold: FACE_MATCH_THRESHOLD,
          status: "matched",
          message: `ตรวจพบ ${bestMatch.employee.fullName}`,
        };

        setMatchResult(newResult);
        setPhase("matched");

        return isMatch;
      }

      // No match within threshold, continue scanning
      return false;
    } catch {
      // Silently continue on errors during detection
      return false;
    }
  }, [findBestMatch, stopDetection]);

  // Start continuous face detection
  const startDetection = useCallback(() => {
    if (!streamRef.current || !videoRef.current) {
      setError("กรุณาเริ่มกล้องก่อนตรวจจับใบหน้า");
      return;
    }

    // Check if any employees have embeddings
    const enrolledCount = employees.filter((emp) => emp.embedding?.vector?.length).length;
    if (enrolledCount === 0) {
      setError("ไม่มีพนักงานที่ลงทะเบียนใบหน้าไว้ กรุณาลงทะเบียนก่อน");
      return;
    }

    setError(null);
    setIsDetecting(true);
    setPhase("detecting");
    setDetectedEmployee(null);
    setMatchResult(null);

    // Start face overlay updates (faster interval)
    faceOverlayIntervalRef.current = setInterval(() => {
      void updateFaceOverlay();
    }, FACE_OVERLAY_INTERVAL_MS);

    // Start detection loop
    detectionIntervalRef.current = setInterval(() => {
      void autoDetectAndVerify();
    }, DETECTION_INTERVAL_MS);

    // Run first detection immediately
    void autoDetectAndVerify();
  }, [employees, autoDetectAndVerify, updateFaceOverlay]);

  // Confirm check-in for detected employee
  const confirmCheckIn = useCallback(async () => {
    if (!detectedEmployee || !matchResult) {
      setError("ไม่พบข้อมูลพนักงานที่ตรวจพบ");
      return false;
    }

    try {
      await repository.recordCheckIn(
        buildEventPayload(
          detectedEmployee.id,
          matchResult.score,
          true,
          matchResult.snapshotDataUrl
        ),
      );

      // Update the match result message to show success
      setMatchResult((prev) =>
        prev
          ? {
              ...prev,
              message: `${detectedEmployee.fullName} เช็คชื่อสำเร็จ`,
            }
          : null
      );

      return true;
    } catch (repoError) {
      setError(
        repoError instanceof Error ? repoError.message : "ไม่สามารถบันทึกการเช็คชื่อได้",
      );
      return false;
    }
  }, [detectedEmployee, matchResult, repository, buildEventPayload]);

  // Enroll face for a specific employee (requires employee selection)
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
        version: "simple-v1",
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
      setError(err instanceof Error ? err.message : "ไม่สามารถลงทะเบียนข้อมูลใบหน้าเป็นฐานได้");
      setPhase("error");
      return false;
    }
  }, [employees, repository, snapshot]);

  // Capture a single frame for enrollment purposes
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
    setMatchResult(null);
    setSnapshot(null);
    setDetectedEmployee(null);
    latestEmbeddingRef.current = null;
    setPhase(streamRef.current ? "camera-ready" : "idle");
    setError(null);
    setDetectedFaces([]);
  }, [stopDetection]);

  // Add a test employee with current face (dev purpose)
  const addTestEmployee = useCallback(async (name: string) => {
    try {
      if (!videoRef.current) {
        throw new Error("กรุณาเริ่มกล้องก่อน");
      }

      setPhase("capturing");
      setError(null);

      const capture = await captureEmbeddingFromVideoAsync(videoRef.current);
      
      if (!capture.faceDetected || capture.embedding.length === 0) {
        throw new Error("ไม่พบใบหน้าในภาพ กรุณาหันหน้าเข้าหากล้อง");
      }
      
      const testEmployee: Employee = {
        id: `test_${Date.now()}`,
        fullName: name,
        email: `${name.toLowerCase().replace(/\s+/g, '.')}@test.local`,
        role: "Test Employee",
        department: "Development",
        avatarUrl: `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(name)}`,
        lastCheckIn: undefined,
        embedding: {
          version: "faceapi-v1", // Updated version for face-api.js embeddings
          vector: capture.embedding,
          createdAt: new Date().toISOString(),
          source: "camera",
        },
      };

      // Add to repository
      if (repository.addEmployee) {
        await repository.addEmployee(testEmployee);
      }
      
      // Update local state
      setEmployees((prev) => [...prev, testEmployee]);
      setSnapshot(capture.dataUrl);
      setPhase("camera-ready");

      return testEmployee;
    } catch (err) {
      setError(err instanceof Error ? err.message : "ไม่สามารถเพิ่มพนักงานทดสอบได้");
      setPhase("error");
      return null;
    }
  }, [repository]);

  // Get video dimensions for coordinate mapping
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
      },
      videoRef,
      matchResult,
      snapshot,
      error,
      detectedFaces,
      getVideoDimensions,
      actions: {
        initializeCamera,
        startDetection,
        stopDetection,
        confirmCheckIn,
        captureForEnrollment,
        enrollFromLastCapture,
        stopCamera,
        resetSession,
        addTestEmployee,
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
      matchResult,
      snapshot,
      error,
      detectedFaces,
      getVideoDimensions,
      initializeCamera,
      startDetection,
      stopDetection,
      confirmCheckIn,
      captureForEnrollment,
      enrollFromLastCapture,
      stopCamera,
      resetSession,
      addTestEmployee,
    ],
  );
};
