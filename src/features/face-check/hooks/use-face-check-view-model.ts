"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Employee,
  FaceEmbedding,
  FaceEmbeddings,
  FaceEmbeddingEntry,
  FaceMatchResult,
  FaceAngle,
  FaceCheckEvent,
} from "@/entities/employee";
import { PROGRESSIVE_LEARNING_CONFIG } from "@/entities/employee";
import { 
  FACE_MATCH_THRESHOLD, 
  ACCURACY_CONFIG,
  captureEmbeddingFromVideoAsync,
  distanceToSimilarity,
  initializeFaceDetection,
  findBestMatchWithConfidenceGap,
  createFaceEmbeddings,
  type DetectedFace,
  type FaceQualityResult,
} from "@/shared/lib/face-embedding";
import { detectSingleFaceWithDescriptor, DETECTION_CONFIG } from "@/shared/lib/face-detection-service";
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
  | "multi-capture" // New phase for multi-angle enrollment
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

// Multi-angle capture state
export interface MultiAngleCaptureState {
  targetAngles: FaceAngle[];
  capturedEntries: FaceEmbeddingEntry[];
  capturedSnapshots: { angle: FaceAngle; dataUrl: string }[];
  currentAngleIndex: number;
  qualityIssues: string[];
}

// Required angles for multi-angle enrollment
export const REQUIRED_ANGLES: FaceAngle[] = ["front", "slight-left", "slight-right"];
export const OPTIONAL_ANGLES: FaceAngle[] = ["left", "right"];
export const MIN_REQUIRED_CAPTURES = 3;

interface UseFaceCheckViewModelOptions {
  repository: EmployeeRepository;
  autoStart?: boolean; // Auto-start camera and detection
}

const DETECTION_INTERVAL_MS = 250; // Balanced detection speed (4 per second)
const CHECK_IN_COOLDOWN_MS = 300; // 0.3 second cooldown - instant transition
const SAME_PERSON_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour cooldown for same person
const STUCK_TIMEOUT_MS = 10000; // 10 seconds timeout for stuck state recovery

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
  
  // Multi-angle capture state
  const [multiAngleState, setMultiAngleState] = useState<MultiAngleCaptureState | null>(null);
  const [lastQuality, setLastQuality] = useState<FaceQualityResult | null>(null);
  
  // Multi-frame confirmation state for reducing false accepts
  // Using refs instead of state to avoid async update issues in detection loop
  const [consecutiveMatchCount, setConsecutiveMatchCount] = useState(0);
  const [lastMatchedEmployeeId, setLastMatchedEmployeeId] = useState<string | null>(null);
  // Refs for immediate updates (state is for UI display)
  const consecutiveMatchCountRef = useRef(0);
  const lastMatchedEmployeeIdRef = useRef<string | null>(null);
  const [matchInCooldown, setMatchInCooldown] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const latestEmbeddingRef = useRef<number[] | null>(null);
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const cooldownTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const recentCheckIns = useRef<Map<string, number>>(new Map()); // employeeId -> timestamp
  const initStartedRef = useRef(false);
  const isDetectionRunningRef = useRef(false); // Proper loop control flag
  const lastSuccessfulActionRef = useRef(Date.now()); // For stuck state detection

  useEffect(() => {
    setIsCameraSupported(Boolean(navigator?.mediaDevices?.getUserMedia));
  }, []);

  // Stop detection
  const stopDetection = useCallback(() => {
    isDetectionRunningRef.current = false; // Signal loop to stop
    if (detectionIntervalRef.current) {
      clearTimeout(detectionIntervalRef.current);
      detectionIntervalRef.current = null;
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

  // Find the best matching employee with confidence gap validation
  const findBestMatch = useCallback((capturedEmbedding: number[]): { 
    match: EmployeeMatch | null; 
    hasConfidenceGap: boolean;
  } => {
    if (!capturedEmbedding || capturedEmbedding.length === 0) {
      return { match: null, hasConfidenceGap: false };
    }

    // Filter enrolled employees (either legacy single embedding or new multi-embeddings)
    const enrolledEmployees = employees.filter(
      (emp) => emp.embeddings?.entries?.length || emp.embedding?.vector?.length
    );

    if (enrolledEmployees.length === 0) {
      return { match: null, hasConfidenceGap: false };
    }

    // Use the new matching function with confidence gap validation
    const result = findBestMatchWithConfidenceGap(
      capturedEmbedding,
      enrolledEmployees.map(emp => ({
        id: emp.id,
        name: emp.fullName,
        embeddings: emp.embeddings,
        embedding: emp.embedding,
      })),
      {
        threshold: FACE_MATCH_THRESHOLD,
        minGap: ACCURACY_CONFIG.MIN_CONFIDENCE_GAP,
      }
    );

    if (!result.bestMatch) {
      return { match: null, hasConfidenceGap: false };
    }

    const employee = employees.find(emp => emp.id === result.bestMatch!.employeeId);
    if (!employee) {
      return { match: null, hasConfidenceGap: false };
    }

    // If only one enrolled employee, skip confidence gap check (no one to compare to)
    const effectiveHasConfidenceGap = enrolledEmployees.length === 1 ? true : result.hasConfidenceGap;

    return {
      match: {
        employee,
        distance: result.bestMatch.distance,
        similarity: distanceToSimilarity(result.bestMatch.distance),
      },
      hasConfidenceGap: effectiveHasConfidenceGap,
    };
  }, [employees]);

  // Check if employee is in cooldown (checks both memory and database logs)
  const isInCooldown = useCallback((employeeId: string): boolean => {
    const now = Date.now();
    
    // Check in-memory cache first (for current session)
    const lastMemoryCheckIn = recentCheckIns.current.get(employeeId);
    if (lastMemoryCheckIn && now - lastMemoryCheckIn < SAME_PERSON_COOLDOWN_MS) {
      return true;
    }
    
    // Check database logs (persisted across refreshes)
    const dbCheckIn = checkInLogs.find(log => log.employeeId === employeeId);
    if (dbCheckIn) {
      const dbCheckInTime = dbCheckIn.timestamp.getTime();
      if (now - dbCheckInTime < SAME_PERSON_COOLDOWN_MS) {
        return true;
      }
    }
    
    return false;
  }, [checkInLogs]);

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

  // Perform auto check-in with progressive face learning
  const performAutoCheckIn = useCallback(async (
    employee: Employee, 
    similarity: number, 
    snapshotDataUrl: string,
    embeddingData?: {
      vector: number[];
      quality: number;
      angle: FaceAngle;
    }
  ): Promise<boolean> => {
    try {
      const capturedAt = new Date().toISOString();
      
      // Record check-in
      await repository.recordCheckIn({
        employeeId: employee.id,
        similarityScore: similarity,
        isMatch: true,
        capturedAt,
        snapshotDataUrl,
        // Include embedding for potential learning
        embeddingVector: embeddingData?.vector,
        embeddingQuality: embeddingData?.quality,
        embeddingAngle: embeddingData?.angle,
      });

      // Progressive learning: add embedding to improve future recognition
      // Only if quality meets threshold and it's a confident match
      if (
        embeddingData &&
        embeddingData.quality >= PROGRESSIVE_LEARNING_CONFIG.MIN_QUALITY_TO_ADD &&
        similarity >= PROGRESSIVE_LEARNING_CONFIG.MIN_SIMILARITY_TO_ADD
      ) {
        try {
          const entry: FaceEmbeddingEntry = {
            vector: embeddingData.vector,
            angle: embeddingData.angle,
            createdAt: capturedAt,
            quality: embeddingData.quality,
          };
          
          const result = await repository.appendEmbedding(employee.id, entry);
          if (result.added) {
            console.log(`Progressive learning: Updated embeddings for ${employee.fullName} (${result.totalCount}/20)`);
          }
        } catch (err) {
          // Don't fail check-in if progressive learning fails
          console.warn("Progressive learning failed:", err);
        }
      }

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
      // Reset refs and state
      consecutiveMatchCountRef.current = 0;
      lastMatchedEmployeeIdRef.current = null;
      setConsecutiveMatchCount(0);
      setLastMatchedEmployeeId(null);
      resetLivenessDetector();
      
      // Restart detection with self-scheduling pattern
      if (streamRef.current && videoRef.current && autoDetectAndCheckInRef.current) {
        setIsDetecting(true);
        isDetectionRunningRef.current = true; // Signal loop to run
        
        const scheduleNextDetection = () => {
          if (!isDetectionRunningRef.current || !streamRef.current || !videoRef.current) return;
          
          detectionIntervalRef.current = setTimeout(async () => {
            if (!isDetectionRunningRef.current) return; // Exit if stopped
            try {
              await autoDetectAndCheckInRef.current?.();
            } finally {
              if (isDetectionRunningRef.current) {
                scheduleNextDetection();
              }
            }
          }, DETECTION_INTERVAL_MS);
        };
        
        // Start the detection loop
        void autoDetectAndCheckInRef.current().then(() => {
          if (isDetectionRunningRef.current) {
            scheduleNextDetection();
          }
        });
      }
    }, CHECK_IN_COOLDOWN_MS);
  }, []);

  // Reset consecutive match counter
  const resetConsecutiveMatch = useCallback(() => {
    consecutiveMatchCountRef.current = 0;
    lastMatchedEmployeeIdRef.current = null;
    setConsecutiveMatchCount(0);
    setLastMatchedEmployeeId(null);
  }, []);

  // Watchdog timer to recover from stuck states
  useEffect(() => {
    if (!isDetecting) return;

    const watchdog = setInterval(() => {
      const timeSinceLastAction = Date.now() - lastSuccessfulActionRef.current;
      if (timeSinceLastAction > STUCK_TIMEOUT_MS) {
        console.warn(`Detection stuck for ${timeSinceLastAction}ms, resetting...`);
        resetLivenessDetector();
        consecutiveMatchCountRef.current = 0;
        lastMatchedEmployeeIdRef.current = null;
        setConsecutiveMatchCount(0);
        setLastMatchedEmployeeId(null);
        setMatchInCooldown(false);
        lastSuccessfulActionRef.current = Date.now();
      }
    }, 5000); // Check every 5 seconds

    return () => clearInterval(watchdog);
  }, [isDetecting]);

  // Auto-detect and auto check-in with multi-frame confirmation
  const autoDetectAndCheckIn = useCallback(async (): Promise<boolean> => {
    try {
      if (!videoRef.current || phase === "cooldown") {
        return false;
      }

      // Capture with quality validation for check-in
      const capture = await captureEmbeddingFromVideoAsync(videoRef.current, { validateQuality: true });
      
      if (!capture.faceDetected || capture.embedding.length === 0) {
        setDetectedFaces([]);
        setLivenessScore(0);
        resetConsecutiveMatch();
        resetLivenessDetector(); // Reset liveness when face is lost
        return false;
      }

      // Face detected - update watchdog timestamp
      lastSuccessfulActionRef.current = Date.now();

      // Quality gate: skip low-quality frames during check-in
      if (capture.quality && capture.quality.score < ACCURACY_CONFIG.MIN_QUALITY_FOR_CHECKIN) {
        return false;
      }

      // Check detection confidence
      if (capture.confidence && capture.confidence < DETECTION_CONFIG.MIN_CONFIDENCE) {
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

      const { match: bestMatch, hasConfidenceGap } = findBestMatch(capture.embedding);

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
        resetConsecutiveMatch(); // Reset on no match
        console.log("[CheckIn] No match found in enrolled employees");
        return false;
      }

      // Use a slightly relaxed threshold for consecutive counting
      // This prevents flickering when match is near threshold
      const SOFT_THRESHOLD = FACE_MATCH_THRESHOLD * 1.2; // ~0.60
      const passesHardThreshold = bestMatch.distance <= FACE_MATCH_THRESHOLD && hasConfidenceGap;
      const passesSoftThreshold = bestMatch.distance <= SOFT_THRESHOLD;

      // Use refs for immediate access (not stale state)
      const currentLastMatchedId = lastMatchedEmployeeIdRef.current;
      const currentConsecutiveCount = consecutiveMatchCountRef.current;

      // Only reset if completely different person or very poor match
      if (!passesSoftThreshold || (currentLastMatchedId && currentLastMatchedId !== bestMatch.employee.id)) {
        resetConsecutiveMatch();
        return false;
      }

      // Check liveness (anti-spoofing)
      if (!livenessDetector.isLive()) {
        return false;
      }

      // Check cooldown for this employee
      if (isInCooldown(bestMatch.employee.id)) {
        setMatchInCooldown(true);
        return false;
      }
      setMatchInCooldown(false);

      // Multi-frame confirmation: track consecutive matches to same person
      // But only count frames that pass the hard threshold
      if (passesHardThreshold) {
        // Check if we need multi-frame confirmation at all
        if (ACCURACY_CONFIG.CONSECUTIVE_MATCHES_REQUIRED <= 1) {
          // Instant check-in mode - no consecutive frames needed
          lastMatchedEmployeeIdRef.current = bestMatch.employee.id;
          consecutiveMatchCountRef.current = 1;
          setLastMatchedEmployeeId(bestMatch.employee.id);
          setConsecutiveMatchCount(1);
          // Proceed to check-in immediately
        } else if (currentLastMatchedId === bestMatch.employee.id) {
          // Same person matched again with good quality
          const newCount = currentConsecutiveCount + 1;
          consecutiveMatchCountRef.current = newCount;
          setConsecutiveMatchCount(newCount);
          
          // Check if we have enough consecutive matches
          if (newCount < ACCURACY_CONFIG.CONSECUTIVE_MATCHES_REQUIRED) {
            return false;
          }
        } else {
          // First match or different person
          lastMatchedEmployeeIdRef.current = bestMatch.employee.id;
          consecutiveMatchCountRef.current = 1;
          setLastMatchedEmployeeId(bestMatch.employee.id);
          setConsecutiveMatchCount(1);
          return false;
        }
      } else {
        // Soft threshold passed but hard threshold failed
        // Keep tracking but don't increment counter
        if (!currentLastMatchedId) {
          lastMatchedEmployeeIdRef.current = bestMatch.employee.id;
          setLastMatchedEmployeeId(bestMatch.employee.id);
        }
        return false;
      }

      // Multi-frame confirmation passed! Perform auto check-in
      stopDetection();
      resetConsecutiveMatch();
      
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

      // Auto check-in with progressive learning
      await performAutoCheckIn(
        bestMatch.employee, 
        bestMatch.similarity, 
        capture.dataUrl,
        // Pass embedding data for progressive learning
        capture.embedding.length > 0 && capture.quality ? {
          vector: capture.embedding,
          quality: capture.quality.score,
          angle: capture.estimatedAngle ?? "front",
        } : undefined
      );

      // Start cooldown then resume detection
      setPhase("cooldown");
      startDetectionAfterCooldown();

      return true;
    } catch {
      resetConsecutiveMatch();
      return false;
    }
  }, [phase, findBestMatch, isInCooldown, stopDetection, performAutoCheckIn, startDetectionAfterCooldown, 
      resetConsecutiveMatch]);

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

    // Count enrolled employees (both single and multi-embeddings)
    const enrolledCount = employees.filter(
      (emp) => emp.embeddings?.entries?.length || emp.embedding?.vector?.length
    ).length;
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
    isDetectionRunningRef.current = true; // Signal loop to run

    // Use self-scheduling pattern to prevent overlapping detection calls
    // This avoids the Chrome "setInterval handler took Xms" violation
    const scheduleNextDetection = () => {
      // Check the running flag instead of just refs
      if (!isDetectionRunningRef.current || !streamRef.current || !videoRef.current) return;
      
      detectionIntervalRef.current = setTimeout(async () => {
        if (!isDetectionRunningRef.current) return; // Exit if stopped
        try {
          await autoDetectAndCheckIn();
        } finally {
          // Schedule next detection only if still running
          if (isDetectionRunningRef.current) {
            scheduleNextDetection();
          }
        }
      }, DETECTION_INTERVAL_MS);
    };

    // Run first detection immediately, then start the loop
    void autoDetectAndCheckIn().then(() => {
      if (isDetectionRunningRef.current) {
        scheduleNextDetection();
      }
    });
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
          // Request highest resolution possible for better face recognition
          width: { ideal: 1920, min: 1280 },
          height: { ideal: 1080, min: 720 },
          // Additional quality settings
          frameRate: { ideal: 30 },
          aspectRatio: { ideal: 16 / 9 },
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

  // Ref to track employees for use in subscriptions without causing re-renders
  const employeesRef = useRef<Employee[]>([]);
  useEffect(() => {
    employeesRef.current = employees;
  }, [employees]);

  useEffect(() => {
    const loadEmployees = async () => {
      setIsLoadingEmployees(true);
      setPhase("loading-employees");
      setError(null);
      try {
        const data = await repository.listEmployees();
        setEmployees(data);
        employeesRef.current = data;
        setPhase("idle");
        
        // Load initial check-in events after employees are loaded
        try {
          const events = await repository.listCheckInEvents(50);
          const logs: CheckInLogEntry[] = events.map((event) => {
            const employee = data.find((e) => e.id === event.employeeId);
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
        } catch (err) {
          console.error("Failed to load check-in events:", err);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "ไม่สามารถโหลดข้อมูลพนักงานได้");
        setPhase("error");
      } finally {
        setIsLoadingEmployees(false);
      }
    };

    loadEmployees();

    // Subscribe to real-time employee updates
    const unsubscribeEmployees = repository.subscribe((updatedEmployees) => {
      setEmployees(updatedEmployees);
      employeesRef.current = updatedEmployees;
    });

    // Subscribe to real-time check-in events
    const unsubscribeCheckIns = repository.subscribeToCheckIns((events) => {
      // Convert events to log entries using ref to avoid dependency issues
      const currentEmployees = employeesRef.current;
      const logs: CheckInLogEntry[] = events.map((event) => {
        const employee = currentEmployees.find((e) => e.id === event.employeeId);
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
      setCheckInLogs(logs.slice(0, 50));
    });

    return () => {
      unsubscribeEmployees();
      unsubscribeCheckIns();
    };
  }, [repository]);

  // Auto-start camera and detection when everything is ready
  useEffect(() => {
    if (!autoStart || initStartedRef.current) return;
    if (!modelsReady || isLoadingEmployees) return;
    if (phase !== "idle") return;

    // Count enrolled employees (both single and multi-embeddings)
    const enrolledCount = employees.filter(
      (emp) => emp.embeddings?.entries?.length || emp.embedding?.vector?.length
    ).length;
    
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

  // Capture a single frame for enrollment (legacy single-image enrollment)
  const captureForEnrollment = useCallback(async () => {
    try {
      if (!videoRef.current) {
        throw new Error("สตรีมกล้องยังไม่พร้อม");
      }

      setPhase("capturing");
      setError(null);

      const capture = await captureEmbeddingFromVideoAsync(videoRef.current, { validateQuality: true });
      
      if (!capture.faceDetected || capture.embedding.length === 0) {
        throw new Error("ไม่พบใบหน้าในภาพ กรุณาหันหน้าเข้าหากล้อง");
      }

      // Check quality
      if (capture.quality && !capture.quality.isValid) {
        setLastQuality(capture.quality);
        throw new Error(capture.quality.issues.join(", ") || "คุณภาพภาพไม่เพียงพอ");
      }

      latestEmbeddingRef.current = capture.embedding;
      setSnapshot(capture.dataUrl);
      setLastQuality(capture.quality ?? null);
      setPhase("camera-ready");

      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "ไม่สามารถถ่ายภาพได้");
      setPhase("error");
      return false;
    }
  }, []);

  // Start multi-angle capture session
  const startMultiAngleCapture = useCallback(() => {
    setMultiAngleState({
      targetAngles: [...REQUIRED_ANGLES],
      capturedEntries: [],
      capturedSnapshots: [],
      currentAngleIndex: 0,
      qualityIssues: [],
    });
    setPhase("multi-capture");
    setError(null);
  }, []);

  // Get guidance text for current angle
  const getAngleGuidance = useCallback((angle: FaceAngle): string => {
    switch (angle) {
      case "front": return "มองตรงไปที่กล้อง";
      case "left": return "หันหน้าไปทางซ้าย (~30°)";
      case "right": return "หันหน้าไปทางขวา (~30°)";
      case "slight-left": return "เอียงหน้าไปทางซ้ายเล็กน้อย (~15°)";
      case "slight-right": return "เอียงหน้าไปทางขวาเล็กน้อย (~15°)";
      default: return "ถ่ายภาพใบหน้า";
    }
  }, []);

  // Capture for multi-angle enrollment
  const captureMultiAngle = useCallback(async (): Promise<{ success: boolean; message: string }> => {
    try {
      if (!videoRef.current) {
        throw new Error("สตรีมกล้องยังไม่พร้อม");
      }

      if (!multiAngleState) {
        throw new Error("ยังไม่ได้เริ่มการถ่ายภาพหลายมุม");
      }

      // Capture with quality validation
      const capture = await captureEmbeddingFromVideoAsync(videoRef.current, { validateQuality: true });
      
      if (!capture.faceDetected || capture.embedding.length === 0) {
        return { success: false, message: "ไม่พบใบหน้าในภาพ กรุณาหันหน้าเข้าหากล้อง" };
      }

      // Validate quality
      if (capture.quality && !capture.quality.isValid) {
        setLastQuality(capture.quality);
        return { success: false, message: capture.quality.issues.join(", ") || "คุณภาพภาพไม่เพียงพอ" };
      }

      const currentAngle = multiAngleState.targetAngles[multiAngleState.currentAngleIndex];
      const detectedAngle = capture.estimatedAngle ?? "front";

      // Check if detected angle matches expected angle (with some tolerance)
      const angleMatches = 
        currentAngle === detectedAngle ||
        (currentAngle === "front" && detectedAngle === "slight-left") ||
        (currentAngle === "front" && detectedAngle === "slight-right") ||
        (currentAngle === "slight-left" && detectedAngle === "left") ||
        (currentAngle === "slight-right" && detectedAngle === "right");

      if (!angleMatches) {
        return { 
          success: false, 
          message: `มุมหน้าไม่ตรงกับที่ต้องการ (ต้องการ: ${getAngleGuidance(currentAngle)})` 
        };
      }

      // Create embedding entry
      const entry: FaceEmbeddingEntry = {
        vector: capture.embedding,
        angle: detectedAngle,
        createdAt: new Date().toISOString(),
        quality: capture.quality?.score,
      };

      // Update state
      const newEntries = [...multiAngleState.capturedEntries, entry];
      const newSnapshots = [...multiAngleState.capturedSnapshots, { angle: detectedAngle, dataUrl: capture.dataUrl }];
      const newIndex = multiAngleState.currentAngleIndex + 1;
      const isComplete = newIndex >= multiAngleState.targetAngles.length;

      setMultiAngleState({
        ...multiAngleState,
        capturedEntries: newEntries,
        capturedSnapshots: newSnapshots,
        currentAngleIndex: newIndex,
      });

      setLastQuality(capture.quality ?? null);
      setSnapshot(capture.dataUrl);

      if (isComplete) {
        // All angles captured
        return { success: true, message: `ถ่ายภาพครบ ${newEntries.length} มุมแล้ว พร้อมบันทึก` };
      }

      const nextAngle = multiAngleState.targetAngles[newIndex];
      return { success: true, message: `บันทึกแล้ว! ถัดไป: ${getAngleGuidance(nextAngle)}` };

    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : "ไม่สามารถถ่ายภาพได้" };
    }
  }, [multiAngleState, getAngleGuidance]);

  // Cancel multi-angle capture
  const cancelMultiAngleCapture = useCallback(() => {
    setMultiAngleState(null);
    setPhase("camera-ready");
    setError(null);
    setLastQuality(null);
  }, []);

  // Complete multi-angle enrollment
  const completeMultiAngleEnrollment = useCallback(async (employeeId: string): Promise<boolean> => {
    try {
      if (!multiAngleState || multiAngleState.capturedEntries.length < MIN_REQUIRED_CAPTURES) {
        throw new Error(`ต้องถ่ายภาพอย่างน้อย ${MIN_REQUIRED_CAPTURES} มุม`);
      }

      const employee = employees.find((item) => item.id === employeeId);
      if (!employee) {
        throw new Error("ไม่พบพนักงาน");
      }

      // Create multi-embeddings object
      const embeddings = createFaceEmbeddings(multiAngleState.capturedEntries, true);

      // Save to repository
      await repository.upsertEmbeddings(employee.id, embeddings);

      // Update local state
      setEmployees((prev) =>
        prev.map((item) => (item.id === employee.id ? { ...item, embeddings } : item))
      );

      // Clear multi-angle state
      setMultiAngleState(null);
      setPhase("camera-ready");
      
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "ไม่สามารถบันทึกข้อมูลใบหน้าได้");
      return false;
    }
  }, [multiAngleState, employees, repository]);

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
        consecutiveMatchCount,
        matchInCooldown, // True when matched person just checked in
      },
      videoRef,
      matchResult,
      snapshot,
      error,
      detectedFaces,
      checkInLogs,
      getVideoDimensions,
      // Multi-angle enrollment state
      multiAngleState,
      lastQuality,
      actions: {
        initializeCamera,
        startDetection,
        stopDetection,
        captureForEnrollment,
        enrollFromLastCapture,
        stopCamera,
        resetSession,
        // Multi-angle enrollment actions
        startMultiAngleCapture,
        captureMultiAngle,
        cancelMultiAngleCapture,
        completeMultiAngleEnrollment,
        getAngleGuidance,
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
      consecutiveMatchCount,
      matchInCooldown,
      matchResult,
      snapshot,
      error,
      detectedFaces,
      checkInLogs,
      getVideoDimensions,
      multiAngleState,
      lastQuality,
      initializeCamera,
      startDetection,
      stopDetection,
      captureForEnrollment,
      enrollFromLastCapture,
      stopCamera,
      resetSession,
      startMultiAngleCapture,
      captureMultiAngle,
      cancelMultiAngleCapture,
      completeMultiAngleEnrollment,
      getAngleGuidance,
    ],
  );
};
