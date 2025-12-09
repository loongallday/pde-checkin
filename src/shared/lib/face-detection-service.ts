"use client";

import * as faceapi from "face-api.js";

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectionResult {
  box: FaceBox;
  score: number;
  landmarks?: faceapi.FaceLandmarks68;
  descriptor?: Float32Array;
}

// Model loading state
let modelsLoaded = false;
let modelsLoading = false;
let modelLoadError: string | null = null;

const MODEL_URL = "/models";

/**
 * Load face-api.js models
 * Models need to be placed in public/models folder
 */
export const loadFaceDetectionModels = async (): Promise<boolean> => {
  if (modelsLoaded) return true;
  if (modelsLoading) {
    // Wait for existing load to complete
    while (modelsLoading) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return modelsLoaded;
  }

  modelsLoading = true;
  modelLoadError = null;

  try {
    // Load models in parallel for faster initialization
    await Promise.all([
      // SSD MobileNet v1 - fast face detection
      faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
      // Tiny Face Detector - even faster, slightly less accurate
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      // Face landmarks - 68 point model
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      // Face recognition - generates 128D face descriptor
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);

    modelsLoaded = true;
    console.log("✅ Face detection models loaded successfully");
    return true;
  } catch (error) {
    modelLoadError = error instanceof Error ? error.message : "Failed to load models";
    console.error("❌ Failed to load face detection models:", error);
    return false;
  } finally {
    modelsLoading = false;
  }
};

/**
 * Check if models are loaded
 */
export const areModelsLoaded = (): boolean => modelsLoaded;

/**
 * Get model loading error
 */
export const getModelLoadError = (): string | null => modelLoadError;

// Detection confidence thresholds
export const DETECTION_CONFIG = {
  // Minimum confidence for face detection
  MIN_CONFIDENCE: 0.6,
  // SSD MobileNet threshold (lower = detects farther/moving faces)
  SSD_MIN_CONFIDENCE: 0.5,
};

/**
 * Detect faces using SSD MobileNet (MORE ACCURATE) with descriptors
 */
export const detectFaces = async (
  video: HTMLVideoElement
): Promise<DetectionResult[]> => {
  if (!modelsLoaded) {
    const loaded = await loadFaceDetectionModels();
    if (!loaded) return [];
  }

  try {
    // Use SSD MobileNet - more accurate, fewer false positives
    const detections = await faceapi
      .detectAllFaces(video, new faceapi.SsdMobilenetv1Options({ 
        minConfidence: DETECTION_CONFIG.SSD_MIN_CONFIDENCE 
      }))
      .withFaceLandmarks()
      .withFaceDescriptors();

    // Filter out very small faces (likely false positives)
    return detections
      .filter(d => d.detection.box.width >= 30 && d.detection.box.height >= 30)
      .map((detection) => ({
        box: {
          x: detection.detection.box.x,
          y: detection.detection.box.y,
          width: detection.detection.box.width,
          height: detection.detection.box.height,
        },
        score: detection.detection.score,
        landmarks: detection.landmarks,
        descriptor: detection.descriptor,
      }));
  } catch (error) {
    console.error("Face detection error:", error);
    return [];
  }
};

/**
 * Detect faces using Tiny Face Detector (faster, for real-time overlay)
 */
export const detectFacesFast = async (
  video: HTMLVideoElement
): Promise<DetectionResult[]> => {
  if (!modelsLoaded) {
    const loaded = await loadFaceDetectionModels();
    if (!loaded) return [];
  }

  try {
    const detections = await faceapi.detectAllFaces(
      video,
      new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })
    );

    return detections.map((detection) => ({
      box: {
        x: detection.box.x,
        y: detection.box.y,
        width: detection.box.width,
        height: detection.box.height,
      },
      score: detection.score,
    }));
  } catch (error) {
    console.error("Fast face detection error:", error);
    return [];
  }
};

/**
 * Detect single face with full descriptor (for enrollment/matching)
 */
export const detectSingleFaceWithDescriptor = async (
  input: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
  options?: { minConfidence?: number }
): Promise<DetectionResult | null> => {
  if (!modelsLoaded) {
    const loaded = await loadFaceDetectionModels();
    if (!loaded) return null;
  }

  const minConfidence = options?.minConfidence ?? DETECTION_CONFIG.MIN_CONFIDENCE;

  try {
    const detection = await faceapi
      .detectSingleFace(input, new faceapi.SsdMobilenetv1Options({ minConfidence }))
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!detection) return null;

    return {
      box: {
        x: detection.detection.box.x,
        y: detection.detection.box.y,
        width: detection.detection.box.width,
        height: detection.detection.box.height,
      },
      score: detection.detection.score,
      landmarks: detection.landmarks,
      descriptor: detection.descriptor,
    };
  } catch (error) {
    console.error("Single face detection error:", error);
    return null;
  }
};

/**
 * Compare two face descriptors
 * Returns euclidean distance (lower = more similar)
 * Typical threshold: 0.6 for same person
 */
export const compareFaceDescriptors = (
  descriptor1: Float32Array,
  descriptor2: Float32Array | number[]
): number => {
  const d2 = descriptor2 instanceof Float32Array ? descriptor2 : new Float32Array(descriptor2);
  return faceapi.euclideanDistance(descriptor1, d2);
};

/**
 * Find best match from a list of labeled descriptors
 */
export const findBestMatch = (
  queryDescriptor: Float32Array,
  labeledDescriptors: Array<{ label: string; descriptor: number[] | Float32Array }>
): { label: string; distance: number } | null => {
  if (labeledDescriptors.length === 0) return null;

  let bestMatch: { label: string; distance: number } | null = null;

  for (const labeled of labeledDescriptors) {
    const d = labeled.descriptor instanceof Float32Array 
      ? labeled.descriptor 
      : new Float32Array(labeled.descriptor);
    const distance = faceapi.euclideanDistance(queryDescriptor, d);

    if (!bestMatch || distance < bestMatch.distance) {
      bestMatch = { label: labeled.label, distance };
    }
  }

  return bestMatch;
};

/**
 * Convert face descriptor to regular number array (for storage)
 */
export const descriptorToArray = (descriptor: Float32Array): number[] => {
  return Array.from(descriptor);
};

/**
 * Get face-api.js instance for advanced usage
 */
export const getFaceApi = () => faceapi;

