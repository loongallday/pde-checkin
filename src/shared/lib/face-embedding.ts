"use client";

import {
  loadFaceDetectionModels,
  areModelsLoaded,
  detectSingleFaceWithDescriptor,
  detectFaces,
  compareFaceDescriptors,
  descriptorToArray,
  DETECTION_CONFIG,
} from "./face-detection-service";
import type { FaceAngle, FaceEmbeddings, FaceEmbeddingEntry } from "@/entities/employee";

export interface FaceBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameCaptureResult {
  dataUrl: string;
  embedding: number[];
  faceDetected: boolean;
  boundingBox?: FaceBoundingBox;
  confidence?: number;
}

// Face detection result for UI overlay
export interface DetectedFace {
  boundingBox: FaceBoundingBox;
  confidence: number;
  employeeName?: string;
  employeeId?: string;
  matchScore?: number;
  distance?: number;
}

// Face match threshold for euclidean distance (lower = stricter)
// 0.35 is VERY strict - only matches if faces are very similar
export const FACE_MATCH_THRESHOLD = 0.35;

// Accuracy config - HIGH SECURITY
export const ACCURACY_CONFIG = {
  // Gap between best match and 2nd best (higher = more certain it's the right person)
  MIN_CONFIDENCE_GAP: 0.15,
  // Require multiple frames of same person before check-in (prevents false positives)
  CONSECUTIVE_MATCHES_REQUIRED: 3,
  // Minimum detection confidence
  MIN_DETECTION_CONFIDENCE: 0.6,
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
 * Initialize face detection models (face-api.js only)
 */
export const initializeFaceDetection = async (): Promise<boolean> => {
  return loadFaceDetectionModels();
};

/**
 * Check if face detection is ready
 */
export const isFaceDetectionReady = (): boolean => {
  return areModelsLoaded();
};

/**
 * Simple capture - just take a photo and detect face
 */
export const captureEmbeddingFromVideoAsync = async (
  video: HTMLVideoElement,
  options?: { jpegQuality?: number }
): Promise<FrameCaptureResult> => {
  if (!video) {
    throw new Error("สตรีมกล้องยังไม่พร้อม");
  }

  const jpegQuality = options?.jpegQuality ?? 0.85;
  const width = video.videoWidth || 640;
  const height = video.videoHeight || 640;

  // Create canvas for snapshot (flipped to match user view)
  const { canvas, context } = createWorkingCanvas(width, height);
  context.save();
  context.scale(-1, 1);
  context.drawImage(video, -width, 0, width, height);
  context.restore();
  const dataUrl = canvas.toDataURL("image/jpeg", jpegQuality);

  // Detect face using face-api.js
  const detection = await detectSingleFaceWithDescriptor(video);

  if (detection && detection.descriptor) {
    return {
      dataUrl,
      embedding: descriptorToArray(detection.descriptor),
      faceDetected: true,
      boundingBox: detection.box,
      confidence: detection.score,
    };
  }

  return {
    dataUrl,
    embedding: [],
    faceDetected: false,
  };
};

/**
 * Detect multiple faces in video (for kiosk)
 */
export const detectMultipleFaces = async (
  video: HTMLVideoElement
): Promise<Array<{ box: FaceBoundingBox; score: number; embedding: number[] }>> => {
  if (!video || video.readyState < 2) return [];

  const detections = await detectFaces(video);
  
  return detections
    .filter(d => d.descriptor && d.score >= DETECTION_CONFIG.MIN_CONFIDENCE)
    .map(d => ({
      box: d.box,
      score: d.score,
      embedding: d.descriptor ? descriptorToArray(d.descriptor) : [],
    }));
};

/**
 * Compare two face embeddings
 */
export const compareFaces = (
  embedding1: number[] | Float32Array,
  embedding2: number[] | Float32Array
): number => {
  if (embedding1.length === 0 || embedding2.length === 0) return Infinity;
  
  const e1 = embedding1 instanceof Float32Array ? embedding1 : new Float32Array(embedding1);
  const e2 = embedding2 instanceof Float32Array ? embedding2 : new Float32Array(embedding2);
  
  return compareFaceDescriptors(e1, e2);
};

/**
 * Check if two faces match
 */
export const facesMatch = (
  embedding1: number[] | Float32Array,
  embedding2: number[] | Float32Array,
  threshold: number = FACE_MATCH_THRESHOLD
): boolean => {
  return compareFaces(embedding1, embedding2) <= threshold;
};

/**
 * Convert distance to similarity score (0-1)
 */
export const distanceToSimilarity = (distance: number): number => {
  return Math.max(0, Math.min(1, 1 - distance / 1.5));
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
  
  return average;
};

/**
 * Create FaceEmbeddings from entries
 */
export const createFaceEmbeddings = (
  entries: FaceEmbeddingEntry[],
  computeAverage = true
): FaceEmbeddings => {
  const now = new Date().toISOString();
  return {
    version: "faceapi-v1",
    entries,
    averageVector: computeAverage ? computeAverageEmbedding(entries.map(e => e.vector)) : undefined,
    createdAt: now,
    updatedAt: now,
    source: "camera",
  };
};

/**
 * Find best match for a single face
 */
export const findBestMatchMultiEmbedding = (
  queryEmbedding: number[],
  employees: Array<{
    id: string;
    name: string;
    embeddings?: FaceEmbeddings;
    embedding?: { vector: number[] };
  }>
): { employeeId: string; employeeName: string; distance: number } | null => {
  if (queryEmbedding.length === 0) return null;
  
  let bestMatch: { employeeId: string; employeeName: string; distance: number } | null = null;
  
  for (const employee of employees) {
    let minDistance = Infinity;
    
    if (employee.embeddings?.entries?.length) {
      for (const entry of employee.embeddings.entries) {
        const distance = compareFaces(queryEmbedding, entry.vector);
        if (distance < minDistance) minDistance = distance;
      }
      if (employee.embeddings.averageVector?.length) {
        const avgDistance = compareFaces(queryEmbedding, employee.embeddings.averageVector);
        if (avgDistance < minDistance) minDistance = avgDistance;
      }
    } else if (employee.embedding?.vector?.length) {
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
 * Find best match with confidence gap
 */
export const findBestMatchWithConfidenceGap = (
  queryEmbedding: number[],
  employees: Array<{
    id: string;
    name: string;
    embeddings?: FaceEmbeddings;
    embedding?: { vector: number[] };
  }>,
  options?: { threshold?: number; minGap?: number }
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
  
  const matches: Array<{ employeeId: string; employeeName: string; distance: number }> = [];
  
  for (const employee of employees) {
    let minDistance = Infinity;
    
    if (employee.embeddings?.entries?.length) {
      for (const entry of employee.embeddings.entries) {
        const distance = compareFaces(queryEmbedding, entry.vector);
        if (distance < minDistance) minDistance = distance;
      }
      if (employee.embeddings.averageVector?.length) {
        const avgDistance = compareFaces(queryEmbedding, employee.embeddings.averageVector);
        if (avgDistance < minDistance) minDistance = avgDistance;
      }
    } else if (employee.embedding?.vector?.length) {
      minDistance = compareFaces(queryEmbedding, employee.embedding.vector);
    }
    
    if (minDistance < Infinity) {
      matches.push({ employeeId: employee.id, employeeName: employee.name, distance: minDistance });
    }
  }
  
  matches.sort((a, b) => a.distance - b.distance);
  
  const bestMatch = matches[0] ?? null;
  const secondBestDistance = matches[1]?.distance ?? Infinity;
  const passesThreshold = bestMatch && bestMatch.distance <= threshold;
  const hasConfidenceGap = secondBestDistance - (bestMatch?.distance ?? 0) >= minGap;
  
  return {
    bestMatch: passesThreshold ? bestMatch : null,
    secondBestDistance,
    hasConfidenceGap: passesThreshold && hasConfidenceGap,
  };
};

/**
 * Match multiple faces against employees (for kiosk multi-person detection)
 */
export const matchMultipleFaces = (
  faces: Array<{ box: FaceBoundingBox; score: number; embedding: number[] }>,
  employees: Array<{
    id: string;
    name: string;
    embeddings?: FaceEmbeddings;
    embedding?: { vector: number[] };
  }>,
  threshold: number = FACE_MATCH_THRESHOLD
): DetectedFace[] => {
  return faces.map(face => {
    const match = findBestMatchMultiEmbedding(face.embedding, employees);
    
    const detected: DetectedFace = {
      boundingBox: face.box,
      confidence: face.score,
    };
    
    if (match && match.distance <= threshold) {
      detected.employeeId = match.employeeId;
      detected.employeeName = match.employeeName;
      detected.distance = match.distance;
      detected.matchScore = distanceToSimilarity(match.distance);
    }
    
    return detected;
  });
};
