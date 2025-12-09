"use client";

import * as tf from "@tensorflow/tfjs";

// FaceNet-like model for face recognition
// We'll use a pre-trained model or create embeddings from face landmarks
let faceRecognitionModel: tf.LayersModel | null = null;
let modelLoaded = false;
let modelLoading = false;

// FaceNet typically produces 128D or 512D embeddings
// We'll use 128D for compatibility with existing embeddings
const EMBEDDING_DIMENSION = 128;

/**
 * Load TensorFlow.js face recognition model
 * For now, we'll use a lightweight approach with face landmarks
 * In production, you'd load a pre-trained FaceNet model
 */
export const loadFaceRecognitionModel = async (): Promise<boolean> => {
  if (modelLoaded) return true;
  if (modelLoading) {
    while (modelLoading) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return modelLoaded;
  }

  modelLoading = true;

  try {
    // For now, we'll create a simple embedding extractor
    // In production, load a pre-trained FaceNet model from:
    // - https://github.com/justadudewhohacks/face-api.js (already have this)
    // - Or use TensorFlow Hub models
    // - Or train your own
    
    // Since we're going full MediaPipe, we'll extract embeddings from MediaPipe landmarks
    // and use a lightweight MLP to convert to face embeddings
    // This is a simplified approach - for production, use a proper FaceNet model
    
    console.log("✅ TensorFlow.js face recognition ready (using MediaPipe landmarks)");
    modelLoaded = true;
    return true;
  } catch (error) {
    console.error("❌ Failed to load TensorFlow.js face recognition:", error);
    modelLoaded = false;
    return false;
  } finally {
    modelLoading = false;
  }
};

/**
 * Generate face embedding from MediaPipe landmarks
 * This converts 468 3D landmarks into a 128D face embedding
 */
export const generateEmbeddingFromLandmarks = async (
  landmarks: Array<{ x: number; y: number; z: number }>
): Promise<number[]> => {
  if (landmarks.length < 468) {
    throw new Error("Insufficient landmarks for embedding generation");
  }

  // Extract key facial features from landmarks
  // This is a simplified approach - in production, use a trained model
  const keyPoints = [
    // Face outline
    landmarks[10], landmarks[151], landmarks[337], landmarks[172], landmarks[397],
    // Eyes
    landmarks[33], landmarks[7], landmarks[163], landmarks[144], landmarks[145],
    landmarks[153], landmarks[154], landmarks[155], landmarks[133], landmarks[173],
    landmarks[157], landmarks[158], landmarks[159], landmarks[160], landmarks[161],
    landmarks[246], landmarks[362], landmarks[398], landmarks[384], landmarks[385],
    landmarks[386], landmarks[387], landmarks[388], landmarks[466], landmarks[263],
    landmarks[249], landmarks[390], landmarks[373], landmarks[374], landmarks[380],
    landmarks[381], landmarks[382],
    // Nose
    landmarks[4], landmarks[5], landmarks[6], landmarks[19], landmarks[20],
    landmarks[94], landmarks[125], landmarks[141], landmarks[235], landmarks[236],
    landmarks[3], landmarks[51], landmarks[48], landmarks[115], landmarks[131],
    landmarks[134], landmarks[102], landmarks[49], landmarks[220], landmarks[305],
    landmarks[281], landmarks[363], landmarks[360], landmarks[279], landmarks[358],
    landmarks[327], landmarks[326], landmarks[2], landmarks[97], landmarks[240],
    // Mouth
    landmarks[61], landmarks[146], landmarks[91], landmarks[181], landmarks[84],
    landmarks[17], landmarks[314], landmarks[405], landmarks[320], landmarks[307],
    landmarks[375], landmarks[321], landmarks[308], landmarks[324], landmarks[318],
    landmarks[13], landmarks[82], landmarks[81], landmarks[80], landmarks[78],
    landmarks[95], landmarks[88], landmarks[178], landmarks[87], landmarks[14],
    landmarks[317], landmarks[402], landmarks[318], landmarks[324],
  ];

  // Normalize coordinates
  const xs = keyPoints.map(p => p.x);
  const ys = keyPoints.map(p => p.y);
  const zs = keyPoints.map(p => p.z);
  
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);

  const normalized = keyPoints.map(p => ({
    x: (p.x - minX) / (maxX - minX || 1),
    y: (p.y - minY) / (maxY - minY || 1),
    z: (p.z - minZ) / (maxZ - minZ || 1),
  }));

  // Create feature vector from normalized points
  const features: number[] = [];
  for (const point of normalized) {
    features.push(point.x, point.y, point.z);
  }

  // Use PCA-like dimensionality reduction to get 128D embedding
  // In production, use a trained neural network
  const embedding = new Array(EMBEDDING_DIMENSION).fill(0);
  
  // Simple feature hashing to reduce dimensions
  for (let i = 0; i < features.length; i++) {
    const idx = i % EMBEDDING_DIMENSION;
    embedding[idx] += features[i] * 0.1; // Weighted sum
  }

  // Normalize embedding
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  if (magnitude > 0) {
    for (let i = 0; i < embedding.length; i++) {
      embedding[i] /= magnitude;
    }
  }

  return embedding;
};

/**
 * Compare two face embeddings using cosine similarity
 * Returns distance (lower = more similar)
 */
export const compareEmbeddings = (
  embedding1: number[] | Float32Array,
  embedding2: number[] | Float32Array
): number => {
  if (embedding1.length === 0 || embedding2.length === 0) return Infinity;
  if (embedding1.length !== embedding2.length) return Infinity;

  const e1 = embedding1 instanceof Float32Array ? embedding1 : new Float32Array(embedding1);
  const e2 = embedding2 instanceof Float32Array ? embedding2 : new Float32Array(embedding2);

  // Calculate euclidean distance
  let sum = 0;
  for (let i = 0; i < e1.length; i++) {
    const diff = e1[i] - e2[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
};

/**
 * Check if models are loaded
 */
export const isFaceRecognitionModelLoaded = (): boolean => modelLoaded;

