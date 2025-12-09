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
  | "capturing"
  | "verifying"
  | "matched"
  | "mismatch"
  | "error";

interface UseFaceCheckViewModelOptions {
  repository: EmployeeRepository;
}

const alignVectors = (a: number[], b: number[]): [number[], number[]] => {
  const size = Math.min(a.length, b.length);
  return [a.slice(0, size), b.slice(0, size)];
};

export const useFaceCheckViewModel = ({
  repository,
}: UseFaceCheckViewModelOptions) => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");
  const [phase, setPhase] = useState<FaceCheckPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [matchResult, setMatchResult] = useState<FaceMatchResult | null>(null);
  const [isCameraSupported, setIsCameraSupported] = useState(false);
  const [isLoadingEmployees, setIsLoadingEmployees] = useState(false);
  const [snapshot, setSnapshot] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const latestEmbeddingRef = useRef<number[] | null>(null);

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
        setSelectedEmployeeId((prev) => prev || data[0]?.id || "");
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

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

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

  const captureAndVerify = useCallback(async () => {
    try {
      if (!videoRef.current) {
        throw new Error("สตรีมกล้องยังไม่พร้อม");
      }

      const employee = employees.find((item) => item.id === selectedEmployeeId);
      if (!employee) {
        throw new Error("กรุณาเลือกพนักงานเพื่อเช็คชื่อ");
      }

      setPhase("capturing");
      setError(null);

      const capture = captureEmbeddingFromVideo(videoRef.current);
      latestEmbeddingRef.current = capture.embedding;
      setSnapshot(capture.dataUrl);

      setPhase("verifying");

      if (!employee.embedding?.vector?.length) {
        throw new Error(
          `${employee.fullName} ยังไม่มีข้อมูลใบหน้าเป็นฐาน กรุณาลงทะเบียนก่อน`,
        );
      }

      const [candidateVector, referenceVector] = alignVectors(
        capture.embedding,
        employee.embedding.vector,
      );
      const similarityScore = cosineSimilarity(candidateVector, referenceVector);
      const isMatch = similarityScore >= FACE_MATCH_THRESHOLD;

      const newResult: FaceMatchResult = {
        employeeId: employee.id,
        capturedAt: new Date().toISOString(),
        snapshotDataUrl: capture.dataUrl,
        score: Number(similarityScore.toFixed(4)),
        threshold: FACE_MATCH_THRESHOLD,
        status: isMatch ? "matched" : "mismatch",
        message: isMatch
          ? `${employee.fullName} เช็คชื่อสำเร็จ`
          : `ตรวจพบใบหน้าไม่ตรงกันสำหรับ ${employee.fullName}`,
      };

      setMatchResult(newResult);
      setPhase(isMatch ? "matched" : "mismatch");

      try {
        await repository.recordCheckIn(
          buildEventPayload(employee.id, similarityScore, isMatch, capture.dataUrl),
        );
      } catch (repoError) {
        setError(
          repoError instanceof Error ? repoError.message : "ไม่สามารถบันทึกการเช็คชื่อได้",
        );
      }

      return isMatch;
    } catch (err) {
      setError(err instanceof Error ? err.message : "ไม่สามารถตรวจสอบใบหน้าได้");
      setPhase("error");
      return false;
    }
  }, [buildEventPayload, employees, repository, selectedEmployeeId]);

  const enrollFromLastCapture = useCallback(async () => {
    try {
      const employee = employees.find((item) => item.id === selectedEmployeeId);
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
  }, [employees, repository, selectedEmployeeId, snapshot]);

  const resetSession = useCallback(() => {
    setMatchResult(null);
    setSnapshot(null);
    latestEmbeddingRef.current = null;
    setPhase(streamRef.current ? "camera-ready" : "idle");
    setError(null);
  }, []);

  return useMemo(
    () => ({
      employees,
      selectedEmployeeId,
      setSelectedEmployeeId,
      repositoryKind: repository.kind,
      status: {
        phase,
        isLoadingEmployees,
        isCameraSupported,
      },
      videoRef,
      matchResult,
      snapshot,
      error,
      actions: {
        initializeCamera,
        captureAndVerify,
        stopCamera,
        enrollFromLastCapture,
        resetSession,
      },
    }),
    [
      employees,
      selectedEmployeeId,
      repository.kind,
      phase,
      isLoadingEmployees,
      isCameraSupported,
      matchResult,
      snapshot,
      error,
      initializeCamera,
      captureAndVerify,
      stopCamera,
      enrollFromLastCapture,
      resetSession,
    ],
  );
};
