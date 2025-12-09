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
  landmarks?: faceapi.FaceLandmarks68;
}

// Face detection result for UI overlay
export interface DetectedFace {
  boundingBox: FaceBoundingBox;
  confidence: number;
  employeeName?: string;
  matchScore?: number;
}

// Face match threshold for euclidean distance (lower = stricter)
// 0.6 is typical threshold for same person
export const FACE_MATCH_THRESHOLD = 0.6;

// Legacy threshold for cosine similarity (kept for compatibility)
export const FACE_MATCH_THRESHOLD_COSINE = 0.82;

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
  options?: { jpegQuality?: number }
): Promise<FrameCaptureResult> => {
  if (!video) {
    throw new Error("สตรีมกล้องยังไม่พร้อม");
  }

  const jpegQuality = options?.jpegQuality ?? 0.85;
  const width = video.videoWidth || 640;
  const height = video.videoHeight || 640;

  // Create canvas for snapshot
  const { canvas, context } = createWorkingCanvas(width, height);
  context.drawImage(video, 0, 0, width, height);
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
      landmarks: detection.landmarks,
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

// Re-export types
export type { DetectionResult, FaceBox };
