import * as faceapi from "face-api.js";
import {
  detectSingleFaceWithDescriptor,
  detectFacesFast,
  loadFaceDetectionModels,
  areModelsLoaded,
  compareFaceDescriptors,
  descriptorToArray,
  type DetectionResult,
  type FaceBox,
} from "./face-detection-service";
import type { FaceAngle, FaceEmbeddings, FaceEmbeddingEntry } from "@/entities/employee";

export interface FaceBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Quality validation result
export interface FaceQualityResult {
  isValid: boolean;
  score: number; // 0-1 overall quality score
  issues: string[];
  details: {
    faceSize: { width: number; height: number; valid: boolean };
    confidence: { value: number; valid: boolean };
    brightness: { value: number; valid: boolean };
    faceAngle: { pitch: number; yaw: number; roll: number; valid: boolean };
  };
}

// Quality thresholds
export const QUALITY_THRESHOLDS = {
  MIN_FACE_SIZE: 100, // Minimum 100x100 pixels
  MIN_CONFIDENCE: 0.7, // Minimum detection confidence
  MIN_BRIGHTNESS: 0.2, // Minimum brightness (0-1)
  MAX_BRIGHTNESS: 0.9, // Maximum brightness (0-1)
  MAX_FACE_ANGLE: 45, // Maximum degrees from frontal
};

export interface FrameCaptureResult {
  dataUrl: string;
  embedding: number[];
  faceDetected: boolean;
  boundingBox?: FaceBoundingBox;
  confidence?: number;
  landmarks?: faceapi.FaceLandmarks68;
  quality?: FaceQualityResult; // Quality assessment
  estimatedAngle?: FaceAngle; // Estimated face angle
}

// Face detection result for UI overlay
export interface DetectedFace {
  boundingBox: FaceBoundingBox;
  confidence: number;
  employeeName?: string;
  matchScore?: number;
}

// Face match threshold for euclidean distance (lower = stricter)
// 0.5 is a good balance between security and usability
// Progressive learning will improve accuracy over time
export const FACE_MATCH_THRESHOLD = 0.5;

// Legacy threshold for cosine similarity (kept for compatibility)
export const FACE_MATCH_THRESHOLD_COSINE = 0.82;

// Accuracy improvement constants
export const ACCURACY_CONFIG = {
  // Minimum gap between best and second-best match to accept
  MIN_CONFIDENCE_GAP: 0.12, // Slightly more lenient
  // Number of consecutive matches required to same person
  CONSECUTIVE_MATCHES_REQUIRED: 1, // Instant check-in after liveness passes
  // Minimum quality score for check-in (not just enrollment)
  MIN_QUALITY_FOR_CHECKIN: 0.6, // More lenient for speed
  // Minimum detection confidence for check-in
  MIN_DETECTION_CONFIDENCE: 0.6, // More lenient for speed
};

const assertBrowser = () => {
  if (typeof window === "undefined") {
    throw new Error("Face detection can only run in browser");
  }
};

const createWorkingCanvas = (width: number, height: number) => {
  assertBrowser();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Cannot create canvas context");
  }
  return { canvas, context };
};

/**
 * Initialize face detection models
 * Call this early in app lifecycle for faster first detection
 */
export const initializeFaceDetection = async (): Promise<boolean> => {
  return loadFaceDetectionModels();
};

/**
 * Check if face detection is ready
 */
export const isFaceDetectionReady = (): boolean => areModelsLoaded();

/**
 * Capture frame and detect face with AI-powered detection
 */
export const captureEmbeddingFromVideoAsync = async (
  video: HTMLVideoElement,
  options?: { jpegQuality?: number; validateQuality?: boolean }
): Promise<FrameCaptureResult> => {
  if (!video) {
    throw new Error("สตรีมกล้องยังไม่พร้อม");
  }

  const jpegQuality = options?.jpegQuality ?? 0.85;
  const validateQuality = options?.validateQuality ?? false;
  const width = video.videoWidth || 640;
  const height = video.videoHeight || 640;

  // Create canvas for snapshot
  const { canvas, context } = createWorkingCanvas(width, height);
  context.drawImage(video, 0, 0, width, height);
  const dataUrl = canvas.toDataURL("image/jpeg", jpegQuality);

  // Detect face using face-api.js
  const detection = await detectSingleFaceWithDescriptor(video);

  if (detection && detection.descriptor) {
    // Validate quality if requested
    const quality = validateQuality 
      ? validateFaceQuality(detection, context, width, height)
      : undefined;
    
    // Estimate face angle if landmarks available
    const estimatedAngle = detection.landmarks 
      ? estimateFaceAngleCategory(detection.landmarks)
      : undefined;
    
    return {
      dataUrl,
      embedding: descriptorToArray(detection.descriptor),
      faceDetected: true,
      boundingBox: detection.box,
      confidence: detection.score,
      landmarks: detection.landmarks,
      quality,
      estimatedAngle,
    };
  }

  // No face detected - return empty embedding
  return {
    dataUrl,
    embedding: [],
    faceDetected: false,
  };
};

/**
 * Synchronous capture (fallback, uses last async result or empty)
 */
export const captureEmbeddingFromVideo = (
  video: HTMLVideoElement,
  options?: { jpegQuality?: number }
): FrameCaptureResult => {
  if (!video) {
    throw new Error("สตรีมกล้องยังไม่พร้อม");
  }

  const jpegQuality = options?.jpegQuality ?? 0.85;
  const width = video.videoWidth || 640;
  const height = video.videoHeight || 640;

  const { canvas, context } = createWorkingCanvas(width, height);
  context.drawImage(video, 0, 0, width, height);
  const dataUrl = canvas.toDataURL("image/jpeg", jpegQuality);

  // Synchronous version cannot do AI detection
  // Return empty embedding - caller should use async version
  return {
    dataUrl,
    embedding: [],
    faceDetected: false,
  };
};

/**
 * Detect faces in video frame for overlay display (fast detection)
 */
export const detectFacesInVideo = async (
  video: HTMLVideoElement
): Promise<FaceBoundingBox[]> => {
  if (!video || video.readyState < 2) return [];

  const detections = await detectFacesFast(video);
  return detections.map((d) => d.box);
};

/**
 * Detect faces with full detection results
 */
export const detectFacesWithDetails = async (
  video: HTMLVideoElement
): Promise<DetectionResult[]> => {
  if (!video || video.readyState < 2) return [];
  return detectFacesFast(video);
};

/**
 * Compare two face embeddings using euclidean distance
 * Lower distance = more similar
 */
export const compareFaces = (
  embedding1: number[] | Float32Array,
  embedding2: number[] | Float32Array
): number => {
  if (embedding1.length === 0 || embedding2.length === 0) return Infinity;
  
  const d1 = embedding1 instanceof Float32Array ? embedding1 : new Float32Array(embedding1);
  const d2 = embedding2 instanceof Float32Array ? embedding2 : new Float32Array(embedding2);
  
  return compareFaceDescriptors(d1, d2);
};

/**
 * Check if two faces match
 */
export const facesMatch = (
  embedding1: number[] | Float32Array,
  embedding2: number[] | Float32Array,
  threshold: number = FACE_MATCH_THRESHOLD
): boolean => {
  const distance = compareFaces(embedding1, embedding2);
  return distance <= threshold;
};

/**
 * Convert distance to similarity score (0-1, higher = more similar)
 */
export const distanceToSimilarity = (distance: number): number => {
  // Map euclidean distance to similarity score
  // Distance 0 = similarity 1, Distance >= 1.5 = similarity 0
  return Math.max(0, Math.min(1, 1 - distance / 1.5));
};

/**
 * Convert similarity score to distance
 */
export const similarityToDistance = (similarity: number): number => {
  return (1 - similarity) * 1.5;
};

/**
 * Estimate face angle from landmarks
 * Returns pitch, yaw, roll in degrees
 */
export const estimateFaceAngle = (
  landmarks: faceapi.FaceLandmarks68
): { pitch: number; yaw: number; roll: number } => {
  const positions = landmarks.positions;
  
  // Get key facial points
  const nose = positions[30]; // Nose tip
  const leftEye = positions[36]; // Left eye outer corner
  const rightEye = positions[45]; // Right eye outer corner
  const chin = positions[8]; // Chin
  const foreheadApprox = { x: (positions[19].x + positions[24].x) / 2, y: (positions[19].y + positions[24].y) / 2 };
  
  // Calculate yaw (left-right rotation) using nose position relative to eye centers
  const eyeCenter = { x: (leftEye.x + rightEye.x) / 2, y: (leftEye.y + rightEye.y) / 2 };
  const eyeWidth = Math.abs(rightEye.x - leftEye.x);
  const noseOffset = (nose.x - eyeCenter.x) / eyeWidth;
  const yaw = noseOffset * 60; // Approximate yaw in degrees
  
  // Calculate roll (head tilt) using eye line angle
  const eyeAngle = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);
  const roll = (eyeAngle * 180) / Math.PI;
  
  // Calculate pitch (up-down) using nose-chin vs nose-forehead ratio
  const noseToForehead = Math.abs(nose.y - foreheadApprox.y);
  const noseToChin = Math.abs(chin.y - nose.y);
  const pitchRatio = (noseToChin - noseToForehead) / (noseToChin + noseToForehead);
  const pitch = pitchRatio * 45; // Approximate pitch in degrees
  
  return { pitch, yaw, roll };
};

/**
 * Estimate which angle category a face is at
 */
export const estimateFaceAngleCategory = (
  landmarks: faceapi.FaceLandmarks68
): FaceAngle => {
  const { yaw } = estimateFaceAngle(landmarks);
  
  if (Math.abs(yaw) < 10) return "front";
  if (yaw < -25) return "left";
  if (yaw > 25) return "right";
  if (yaw < -10) return "slight-left";
  return "slight-right";
};

/**
 * Calculate image brightness from canvas
 */
const calculateBrightness = (context: CanvasRenderingContext2D, width: number, height: number): number => {
  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;
  let totalBrightness = 0;
  const pixelCount = width * height;
  
  for (let i = 0; i < data.length; i += 4) {
    // Calculate perceived brightness using luminosity formula
    const brightness = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
    totalBrightness += brightness;
  }
  
  return totalBrightness / pixelCount;
};

/**
 * Validate face quality for enrollment
 */
export const validateFaceQuality = (
  detection: DetectionResult,
  context?: CanvasRenderingContext2D,
  width?: number,
  height?: number
): FaceQualityResult => {
  const issues: string[] = [];
  let score = 1.0;
  
  // Check face size
  const faceWidth = detection.box.width;
  const faceHeight = detection.box.height;
  const faceSizeValid = faceWidth >= QUALITY_THRESHOLDS.MIN_FACE_SIZE && 
                        faceHeight >= QUALITY_THRESHOLDS.MIN_FACE_SIZE;
  if (!faceSizeValid) {
    issues.push(`ใบหน้าเล็กเกินไป (${Math.round(faceWidth)}x${Math.round(faceHeight)}px)`);
    score -= 0.3;
  }
  
  // Check detection confidence
  const confidenceValid = detection.score >= QUALITY_THRESHOLDS.MIN_CONFIDENCE;
  if (!confidenceValid) {
    issues.push(`ความมั่นใจในการตรวจจับต่ำ (${Math.round(detection.score * 100)}%)`);
    score -= 0.2;
  }
  
  // Check brightness if context available
  let brightnessValue = 0.5; // Default to neutral
  let brightnessValid = true;
  if (context && width && height) {
    brightnessValue = calculateBrightness(context, width, height);
    brightnessValid = brightnessValue >= QUALITY_THRESHOLDS.MIN_BRIGHTNESS && 
                      brightnessValue <= QUALITY_THRESHOLDS.MAX_BRIGHTNESS;
    if (!brightnessValid) {
      if (brightnessValue < QUALITY_THRESHOLDS.MIN_BRIGHTNESS) {
        issues.push("ภาพมืดเกินไป");
      } else {
        issues.push("ภาพสว่างเกินไป");
      }
      score -= 0.2;
    }
  }
  
  // Check face angle if landmarks available
  let angleDetails = { pitch: 0, yaw: 0, roll: 0, valid: true };
  if (detection.landmarks) {
    const angles = estimateFaceAngle(detection.landmarks);
    angleDetails = {
      ...angles,
      valid: Math.abs(angles.yaw) <= QUALITY_THRESHOLDS.MAX_FACE_ANGLE &&
             Math.abs(angles.pitch) <= QUALITY_THRESHOLDS.MAX_FACE_ANGLE &&
             Math.abs(angles.roll) <= 30,
    };
    if (!angleDetails.valid) {
      issues.push("มุมใบหน้าเอียงมากเกินไป");
      score -= 0.2;
    }
  }
  
  return {
    isValid: issues.length === 0,
    score: Math.max(0, score),
    issues,
    details: {
      faceSize: { width: faceWidth, height: faceHeight, valid: faceSizeValid },
      confidence: { value: detection.score, valid: confidenceValid },
      brightness: { value: brightnessValue, valid: brightnessValid },
      faceAngle: angleDetails,
    },
  };
};

/**
 * Compute average embedding from multiple embeddings
 */
export const computeAverageEmbedding = (embeddings: number[][]): number[] => {
  if (embeddings.length === 0) return [];
  if (embeddings.length === 1) return [...embeddings[0]];
  
  const dimension = embeddings[0].length;
  const average = new Array(dimension).fill(0);
  
  for (const embedding of embeddings) {
    for (let i = 0; i < dimension; i++) {
      average[i] += embedding[i];
    }
  }
  
  for (let i = 0; i < dimension; i++) {
    average[i] /= embeddings.length;
  }
  
  // Normalize the averaged vector
  const magnitude = Math.sqrt(average.reduce((sum, val) => sum + val * val, 0));
  if (magnitude > 0) {
    for (let i = 0; i < dimension; i++) {
      average[i] /= magnitude;
    }
  }
  
  return average;
};

/**
 * Create a FaceEmbeddings object from multiple captures
 */
export const createFaceEmbeddings = (
  entries: FaceEmbeddingEntry[],
  computeAverage = true
): FaceEmbeddings => {
  const now = new Date().toISOString();
  const averageVector = computeAverage 
    ? computeAverageEmbedding(entries.map(e => e.vector))
    : undefined;
  
  return {
    version: "faceapi-v1",
    entries,
    averageVector,
    createdAt: now,
    updatedAt: now,
    source: "camera",
  };
};

/**
 * Progressive learning: add or replace embedding in existing embeddings
 * - Adds new embedding if under MAX_EMBEDDINGS
 * - Replaces lowest quality embedding if at capacity and new is better
 * - Maintains diversity by checking angle distribution
 */
export const aggregateEmbedding = (
  existingEmbeddings: FaceEmbeddings | undefined,
  newEntry: FaceEmbeddingEntry,
  config: {
    maxEmbeddings: number;
    replaceThreshold: number;
  }
): FaceEmbeddings => {
  const now = new Date().toISOString();
  
  // If no existing embeddings, create new
  if (!existingEmbeddings || !existingEmbeddings.entries.length) {
    return {
      version: "faceapi-v1",
      entries: [newEntry],
      averageVector: newEntry.vector,
      createdAt: now,
      updatedAt: now,
      source: "camera",
    };
  }

  const entries = [...existingEmbeddings.entries];
  const newQuality = newEntry.quality ?? 0.5;

  // Check if we have room for more entries
  if (entries.length < config.maxEmbeddings) {
    // Simply add the new entry
    entries.push(newEntry);
  } else {
    // At capacity - find lowest quality entry to potentially replace
    let lowestIndex = 0;
    let lowestQuality = entries[0].quality ?? 0.5;

    for (let i = 1; i < entries.length; i++) {
      const quality = entries[i].quality ?? 0.5;
      if (quality < lowestQuality) {
        lowestQuality = quality;
        lowestIndex = i;
      }
    }

    // Replace only if new embedding is significantly better
    if (newQuality > lowestQuality + config.replaceThreshold) {
      entries[lowestIndex] = newEntry;
    } else {
      // Check if we need more diversity (different angle)
      const angleCount = new Map<string, number>();
      for (const entry of entries) {
        angleCount.set(entry.angle, (angleCount.get(entry.angle) || 0) + 1);
      }
      
      const newAngleCount = angleCount.get(newEntry.angle) || 0;
      const avgPerAngle = entries.length / angleCount.size;
      
      // If this angle is underrepresented, consider replacing an overrepresented angle
      if (newAngleCount < avgPerAngle * 0.5) {
        // Find an overrepresented angle with low quality
        let replaceIndex = -1;
        let replaceScore = Infinity;
        
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          const count = angleCount.get(entry.angle) || 0;
          // Prioritize replacing overrepresented angles with low quality
          if (count > avgPerAngle) {
            const quality = entry.quality ?? 0.5;
            if (quality < replaceScore) {
              replaceScore = quality;
              replaceIndex = i;
            }
          }
        }
        
        if (replaceIndex >= 0 && newQuality > replaceScore) {
          entries[replaceIndex] = newEntry;
        }
      }
      // If conditions not met, don't add (keep existing quality embeddings)
    }
  }

  // Recompute average vector
  const averageVector = computeAverageEmbedding(entries.map(e => e.vector));

  return {
    ...existingEmbeddings,
    entries,
    averageVector,
    updatedAt: now,
  };
};

/**
 * Get statistics about the embeddings collection
 */
export const getEmbeddingsStats = (embeddings: FaceEmbeddings | undefined): {
  count: number;
  avgQuality: number;
  angleDistribution: Record<string, number>;
  oldestEntry: string | null;
  newestEntry: string | null;
} => {
  if (!embeddings || !embeddings.entries.length) {
    return {
      count: 0,
      avgQuality: 0,
      angleDistribution: {},
      oldestEntry: null,
      newestEntry: null,
    };
  }

  const entries = embeddings.entries;
  const totalQuality = entries.reduce((sum, e) => sum + (e.quality ?? 0.5), 0);
  const avgQuality = totalQuality / entries.length;

  const angleDistribution: Record<string, number> = {};
  for (const entry of entries) {
    angleDistribution[entry.angle] = (angleDistribution[entry.angle] || 0) + 1;
  }

  const sortedByDate = [...entries].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  return {
    count: entries.length,
    avgQuality,
    angleDistribution,
    oldestEntry: sortedByDate[0]?.createdAt ?? null,
    newestEntry: sortedByDate[sortedByDate.length - 1]?.createdAt ?? null,
  };
};

/**
 * Find best match from multiple embeddings per employee (best-of-N approach)
 * Returns the minimum distance across all embeddings for each employee
 */
export const findBestMatchMultiEmbedding = (
  queryEmbedding: number[],
  employees: Array<{
    id: string;
    name: string;
    embeddings?: FaceEmbeddings;
    embedding?: { vector: number[] }; // Legacy single embedding
  }>
): { employeeId: string; employeeName: string; distance: number } | null => {
  if (queryEmbedding.length === 0) return null;
  
  let bestMatch: { employeeId: string; employeeName: string; distance: number } | null = null;
  
  for (const employee of employees) {
    let minDistance = Infinity;
    
    // Check multi-embeddings first (preferred)
    if (employee.embeddings?.entries?.length) {
      for (const entry of employee.embeddings.entries) {
        const distance = compareFaces(queryEmbedding, entry.vector);
        if (distance < minDistance) {
          minDistance = distance;
        }
      }
      
      // Also check against average if available
      if (employee.embeddings.averageVector?.length) {
        const avgDistance = compareFaces(queryEmbedding, employee.embeddings.averageVector);
        // Use average only if it's better (shouldn't usually be, but as fallback)
        if (avgDistance < minDistance) {
          minDistance = avgDistance;
        }
      }
    }
    // Fall back to legacy single embedding
    else if (employee.embedding?.vector?.length) {
      minDistance = compareFaces(queryEmbedding, employee.embedding.vector);
    }
    
    if (minDistance < Infinity && (!bestMatch || minDistance < bestMatch.distance)) {
      bestMatch = {
        employeeId: employee.id,
        employeeName: employee.name,
        distance: minDistance,
      };
    }
  }
  
  return bestMatch;
};

/**
 * Find best match with confidence gap validation
 * Returns best match only if it's significantly better than second-best
 */
export const findBestMatchWithConfidenceGap = (
  queryEmbedding: number[],
  employees: Array<{
    id: string;
    name: string;
    embeddings?: FaceEmbeddings;
    embedding?: { vector: number[] };
  }>,
  options?: {
    threshold?: number;
    minGap?: number;
  }
): { 
  bestMatch: { employeeId: string; employeeName: string; distance: number } | null;
  secondBestDistance: number;
  hasConfidenceGap: boolean;
} => {
  const threshold = options?.threshold ?? FACE_MATCH_THRESHOLD;
  const minGap = options?.minGap ?? ACCURACY_CONFIG.MIN_CONFIDENCE_GAP;
  
  if (queryEmbedding.length === 0) {
    return { bestMatch: null, secondBestDistance: Infinity, hasConfidenceGap: false };
  }
  
  // Calculate distances for all employees
  const matches: Array<{ employeeId: string; employeeName: string; distance: number }> = [];
  
  for (const employee of employees) {
    let minDistance = Infinity;
    
    if (employee.embeddings?.entries?.length) {
      for (const entry of employee.embeddings.entries) {
        const distance = compareFaces(queryEmbedding, entry.vector);
        if (distance < minDistance) {
          minDistance = distance;
        }
      }
      if (employee.embeddings.averageVector?.length) {
        const avgDistance = compareFaces(queryEmbedding, employee.embeddings.averageVector);
        if (avgDistance < minDistance) {
          minDistance = avgDistance;
        }
      }
    } else if (employee.embedding?.vector?.length) {
      minDistance = compareFaces(queryEmbedding, employee.embedding.vector);
    }
    
    if (minDistance < Infinity) {
      matches.push({
        employeeId: employee.id,
        employeeName: employee.name,
        distance: minDistance,
      });
    }
  }
  
  // Sort by distance (ascending)
  matches.sort((a, b) => a.distance - b.distance);
  
  const bestMatch = matches[0] ?? null;
  const secondBestDistance = matches[1]?.distance ?? Infinity;
  
  // Check if best match passes threshold and has sufficient gap from second-best
  const passesThreshold = bestMatch && bestMatch.distance <= threshold;
  const hasConfidenceGap = secondBestDistance - (bestMatch?.distance ?? 0) >= minGap;
  
  return {
    bestMatch: passesThreshold ? bestMatch : null,
    secondBestDistance,
    hasConfidenceGap: passesThreshold && hasConfidenceGap,
  };
};

/**
 * Align and normalize face for better embedding consistency
 * Uses affine transformation based on eye positions
 */
export const alignFace = async (
  video: HTMLVideoElement,
  landmarks: faceapi.FaceLandmarks68,
  targetSize = 224
): Promise<HTMLCanvasElement> => {
  const positions = landmarks.positions;
  
  // Get eye centers
  const leftEyeCenter = {
    x: (positions[36].x + positions[39].x) / 2,
    y: (positions[36].y + positions[39].y) / 2,
  };
  const rightEyeCenter = {
    x: (positions[42].x + positions[45].x) / 2,
    y: (positions[42].y + positions[45].y) / 2,
  };
  
  // Calculate rotation angle
  const angle = Math.atan2(
    rightEyeCenter.y - leftEyeCenter.y,
    rightEyeCenter.x - leftEyeCenter.x
  );
  
  // Calculate scale based on eye distance
  const eyeDistance = Math.sqrt(
    Math.pow(rightEyeCenter.x - leftEyeCenter.x, 2) +
    Math.pow(rightEyeCenter.y - leftEyeCenter.y, 2)
  );
  const desiredEyeDistance = targetSize * 0.3; // Eyes should be 30% of target width
  const scale = desiredEyeDistance / eyeDistance;
  
  // Create output canvas
  const canvas = document.createElement("canvas");
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Cannot create canvas context");
  
  // Calculate center point between eyes
  const eyeCenter = {
    x: (leftEyeCenter.x + rightEyeCenter.x) / 2,
    y: (leftEyeCenter.y + rightEyeCenter.y) / 2,
  };
  
  // Apply transformation
  ctx.translate(targetSize / 2, targetSize * 0.4); // Position eyes at 40% from top
  ctx.rotate(-angle);
  ctx.scale(scale, scale);
  ctx.translate(-eyeCenter.x, -eyeCenter.y);
  
  // Draw the video frame
  ctx.drawImage(video, 0, 0);
  
  return canvas;
};

// Re-export types
export type { DetectionResult, FaceBox };
