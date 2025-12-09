"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Employee,
  FaceCheckEventPayload,
  FaceEmbedding,
  FaceMatchResult,
} from "@/entities/employee";
import { FACE_MATCH_THRESHOLD, captureEmbeddingFromVideo } from "@/shared/lib/face-embedding";
import { cosineSimilarity } from "@/shared/lib/math";
import type { EmployeeRepository } from "@/shared/repositories/employee-repository";

export type FaceCheckPhase =
  | "idle"
  | "loading-employees"
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

const DETECTION_INTERVAL_MS = 1500; // Scan every 1.5 seconds

const alignVectors = (a: number[], b: number[]): [number[], number[]] => {
  const size = Math.min(a.length, b.length);
  return [a.slice(0, size), b.slice(0, size)];
};

interface EmployeeMatch {
  employee: Employee;
  score: number;
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

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const latestEmbeddingRef = useRef<number[] | null>(null);
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setIsCameraSupported(Boolean(navigator?.mediaDevices?.getUserMedia));
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
    setIsDetecting(false);
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

  // Find the best matching employee from all enrolled employees
  const findBestMatch = useCallback((capturedEmbedding: number[]): EmployeeMatch | null => {
    const enrolledEmployees = employees.filter(
      (emp) => emp.embedding?.vector?.length
    );

    if (enrolledEmployees.length === 0) {
      return null;
    }

    let bestMatch: EmployeeMatch | null = null;

    for (const employee of enrolledEmployees) {
      if (!employee.embedding?.vector) continue;

      const [candidateVector, referenceVector] = alignVectors(
        capturedEmbedding,
        employee.embedding.vector,
      );
      const score = cosineSimilarity(candidateVector, referenceVector);

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { employee, score };
      }
    }

    return bestMatch;
  }, [employees]);

  // Auto-detect and verify against all employees
  const autoDetectAndVerify = useCallback(async (): Promise<boolean> => {
    try {
      if (!videoRef.current) {
        return false; // Silently fail during detection loop
      }

      const capture = captureEmbeddingFromVideo(videoRef.current);
      const bestMatch = findBestMatch(capture.embedding);

      if (!bestMatch) {
        // No enrolled employees, continue scanning
        return false;
      }

      if (bestMatch.score >= FACE_MATCH_THRESHOLD) {
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
          score: Number(bestMatch.score.toFixed(4)),
          threshold: FACE_MATCH_THRESHOLD,
          status: "matched",
          message: `ตรวจพบ ${bestMatch.employee.fullName}`,
        };

        setMatchResult(newResult);
        setPhase("matched");

        return isMatch;
      }

      // No match above threshold, continue scanning
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

    // Start detection loop
    detectionIntervalRef.current = setInterval(() => {
      void autoDetectAndVerify();
    }, DETECTION_INTERVAL_MS);

    // Run first detection immediately
    void autoDetectAndVerify();
  }, [employees, autoDetectAndVerify]);

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
  const captureForEnrollment = useCallback(() => {
    try {
      if (!videoRef.current) {
        throw new Error("สตรีมกล้องยังไม่พร้อม");
      }

      setPhase("capturing");
      setError(null);

      const capture = captureEmbeddingFromVideo(videoRef.current);
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
  }, [stopDetection]);

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
      },
      videoRef,
      matchResult,
      snapshot,
      error,
      actions: {
        initializeCamera,
        startDetection,
        stopDetection,
        confirmCheckIn,
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
      matchResult,
      snapshot,
      error,
      initializeCamera,
      startDetection,
      stopDetection,
      confirmCheckIn,
      captureForEnrollment,
      enrollFromLastCapture,
      stopCamera,
      resetSession,
    ],
  );
};
