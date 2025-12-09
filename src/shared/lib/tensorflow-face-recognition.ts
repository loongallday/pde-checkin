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
 * Uses geometric ratios and distances for better discrimination
 */
export const generateEmbeddingFromLandmarks = async (
  landmarks: Array<{ x: number; y: number; z: number }>
): Promise<number[]> => {
  if (landmarks.length < 468) {
    throw new Error("Insufficient landmarks for embedding generation");
  }

  // Key landmark indices for facial features
  const LANDMARKS = {
    // Eyes
    leftEyeOuter: 33,
    leftEyeInner: 133,
    rightEyeOuter: 362,
    rightEyeInner: 263,
    leftEyeTop: 159,
    leftEyeBottom: 145,
    rightEyeTop: 386,
    rightEyeBottom: 374,
    // Eyebrows
    leftBrowInner: 107,
    leftBrowOuter: 70,
    rightBrowInner: 336,
    rightBrowOuter: 300,
    // Nose
    noseTip: 4,
    noseBottom: 2,
    noseLeftAlar: 98,
    noseRightAlar: 327,
    noseBridge: 6,
    // Mouth
    mouthLeft: 61,
    mouthRight: 291,
    upperLipTop: 13,
    lowerLipBottom: 14,
    // Face contour
    chin: 152,
    foreheadCenter: 10,
    leftCheek: 234,
    rightCheek: 454,
    leftTemple: 127,
    rightTemple: 356,
    jawLeft: 172,
    jawRight: 397,
  };

  // Helper to calculate distance between two landmarks
  const dist = (i1: number, i2: number): number => {
    const p1 = landmarks[i1];
    const p2 = landmarks[i2];
    return Math.sqrt(
      Math.pow(p2.x - p1.x, 2) + 
      Math.pow(p2.y - p1.y, 2) + 
      Math.pow(p2.z - p1.z, 2)
    );
  };

  // Helper to calculate angle between three points
  const angle = (i1: number, i2: number, i3: number): number => {
    const p1 = landmarks[i1];
    const p2 = landmarks[i2];
    const p3 = landmarks[i3];
    const v1 = { x: p1.x - p2.x, y: p1.y - p2.y, z: p1.z - p2.z };
    const v2 = { x: p3.x - p2.x, y: p3.y - p2.y, z: p3.z - p2.z };
    const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
    const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y + v1.z * v1.z);
    const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + v2.z * v2.z);
    return Math.acos(Math.max(-1, Math.min(1, dot / (mag1 * mag2 || 1))));
  };

  // Reference distance for normalization (eye distance)
  const eyeDistance = dist(LANDMARKS.leftEyeOuter, LANDMARKS.rightEyeOuter);
  const normalize = (d: number) => d / (eyeDistance || 1);

  // Generate discriminative features based on facial geometry
  const features: number[] = [];

  // 1. Eye measurements (8 features)
  features.push(normalize(dist(LANDMARKS.leftEyeOuter, LANDMARKS.leftEyeInner))); // Left eye width
  features.push(normalize(dist(LANDMARKS.rightEyeOuter, LANDMARKS.rightEyeInner))); // Right eye width
  features.push(normalize(dist(LANDMARKS.leftEyeTop, LANDMARKS.leftEyeBottom))); // Left eye height
  features.push(normalize(dist(LANDMARKS.rightEyeTop, LANDMARKS.rightEyeBottom))); // Right eye height
  features.push(normalize(dist(LANDMARKS.leftEyeInner, LANDMARKS.rightEyeInner))); // Inner eye distance
  features.push(normalize(dist(LANDMARKS.leftEyeOuter, LANDMARKS.noseTip))); // Left eye to nose
  features.push(normalize(dist(LANDMARKS.rightEyeOuter, LANDMARKS.noseTip))); // Right eye to nose
  features.push(angle(LANDMARKS.leftEyeOuter, LANDMARKS.noseTip, LANDMARKS.rightEyeOuter) / Math.PI); // Eye-nose angle

  // 2. Eyebrow measurements (6 features)
  features.push(normalize(dist(LANDMARKS.leftBrowInner, LANDMARKS.leftBrowOuter))); // Left brow length
  features.push(normalize(dist(LANDMARKS.rightBrowInner, LANDMARKS.rightBrowOuter))); // Right brow length
  features.push(normalize(dist(LANDMARKS.leftBrowInner, LANDMARKS.leftEyeTop))); // Left brow to eye
  features.push(normalize(dist(LANDMARKS.rightBrowInner, LANDMARKS.rightEyeTop))); // Right brow to eye
  features.push(normalize(dist(LANDMARKS.leftBrowInner, LANDMARKS.rightBrowInner))); // Inner brow distance
  features.push(angle(LANDMARKS.leftBrowOuter, LANDMARKS.foreheadCenter, LANDMARKS.rightBrowOuter) / Math.PI);

  // 3. Nose measurements (8 features)
  features.push(normalize(dist(LANDMARKS.noseBridge, LANDMARKS.noseTip))); // Nose bridge length
  features.push(normalize(dist(LANDMARKS.noseTip, LANDMARKS.noseBottom))); // Nose tip to bottom
  features.push(normalize(dist(LANDMARKS.noseLeftAlar, LANDMARKS.noseRightAlar))); // Nose width
  features.push(normalize(dist(LANDMARKS.noseTip, LANDMARKS.upperLipTop))); // Nose to lip
  features.push(normalize(dist(LANDMARKS.noseBridge, LANDMARKS.foreheadCenter))); // Nose bridge to forehead
  features.push(angle(LANDMARKS.noseLeftAlar, LANDMARKS.noseTip, LANDMARKS.noseRightAlar) / Math.PI);
  features.push(angle(LANDMARKS.leftEyeInner, LANDMARKS.noseTip, LANDMARKS.rightEyeInner) / Math.PI);
  features.push(normalize(dist(LANDMARKS.noseTip, LANDMARKS.chin))); // Nose to chin

  // 4. Mouth measurements (8 features)
  features.push(normalize(dist(LANDMARKS.mouthLeft, LANDMARKS.mouthRight))); // Mouth width
  features.push(normalize(dist(LANDMARKS.upperLipTop, LANDMARKS.lowerLipBottom))); // Mouth height
  features.push(normalize(dist(LANDMARKS.mouthLeft, LANDMARKS.noseTip))); // Mouth to nose (left)
  features.push(normalize(dist(LANDMARKS.mouthRight, LANDMARKS.noseTip))); // Mouth to nose (right)
  features.push(normalize(dist(LANDMARKS.upperLipTop, LANDMARKS.noseTip))); // Upper lip to nose
  features.push(normalize(dist(LANDMARKS.lowerLipBottom, LANDMARKS.chin))); // Lower lip to chin
  features.push(angle(LANDMARKS.mouthLeft, LANDMARKS.upperLipTop, LANDMARKS.mouthRight) / Math.PI);
  features.push(angle(LANDMARKS.mouthLeft, LANDMARKS.lowerLipBottom, LANDMARKS.mouthRight) / Math.PI);

  // 5. Face contour measurements (10 features)
  features.push(normalize(dist(LANDMARKS.foreheadCenter, LANDMARKS.chin))); // Face height
  features.push(normalize(dist(LANDMARKS.leftCheek, LANDMARKS.rightCheek))); // Face width at cheeks
  features.push(normalize(dist(LANDMARKS.leftTemple, LANDMARKS.rightTemple))); // Face width at temples
  features.push(normalize(dist(LANDMARKS.jawLeft, LANDMARKS.jawRight))); // Jaw width
  features.push(normalize(dist(LANDMARKS.leftTemple, LANDMARKS.jawLeft))); // Left face length
  features.push(normalize(dist(LANDMARKS.rightTemple, LANDMARKS.jawRight))); // Right face length
  features.push(normalize(dist(LANDMARKS.foreheadCenter, LANDMARKS.noseTip))); // Forehead to nose
  features.push(normalize(dist(LANDMARKS.leftCheek, LANDMARKS.chin))); // Left cheek to chin
  features.push(normalize(dist(LANDMARKS.rightCheek, LANDMARKS.chin))); // Right cheek to chin
  features.push(angle(LANDMARKS.leftTemple, LANDMARKS.chin, LANDMARKS.rightTemple) / Math.PI); // Face angle

  // 6. Cross-feature ratios (10 features) - highly discriminative
  const faceHeight = dist(LANDMARKS.foreheadCenter, LANDMARKS.chin);
  const faceWidth = dist(LANDMARKS.leftCheek, LANDMARKS.rightCheek);
  const noseLength = dist(LANDMARKS.noseBridge, LANDMARKS.noseBottom);
  const mouthWidth = dist(LANDMARKS.mouthLeft, LANDMARKS.mouthRight);
  const eyeWidth = dist(LANDMARKS.leftEyeOuter, LANDMARKS.leftEyeInner);
  
  features.push(faceHeight / (faceWidth || 1)); // Face aspect ratio
  features.push(eyeDistance / (faceWidth || 1)); // Eye span ratio
  features.push(noseLength / (faceHeight || 1)); // Nose proportion
  features.push(mouthWidth / (faceWidth || 1)); // Mouth width ratio
  features.push(eyeWidth / (eyeDistance || 1)); // Eye size ratio
  features.push(dist(LANDMARKS.noseTip, LANDMARKS.chin) / (faceHeight || 1)); // Lower face ratio
  features.push(dist(LANDMARKS.foreheadCenter, LANDMARKS.noseBridge) / (faceHeight || 1)); // Upper face ratio
  features.push(dist(LANDMARKS.leftBrowInner, LANDMARKS.leftEyeTop) / (eyeWidth || 1)); // Brow height ratio
  features.push(dist(LANDMARKS.upperLipTop, LANDMARKS.noseBottom) / (noseLength || 1)); // Philtrum ratio
  features.push(dist(LANDMARKS.lowerLipBottom, LANDMARKS.chin) / (faceHeight || 1)); // Chin proportion

  // 7. Z-depth features (8 features) - 3D structure
  const avgZ = landmarks.reduce((sum, p) => sum + p.z, 0) / landmarks.length;
  features.push((landmarks[LANDMARKS.noseTip].z - avgZ) * 10); // Nose protrusion
  features.push((landmarks[LANDMARKS.leftEyeOuter].z - landmarks[LANDMARKS.leftEyeInner].z) * 10);
  features.push((landmarks[LANDMARKS.rightEyeOuter].z - landmarks[LANDMARKS.rightEyeInner].z) * 10);
  features.push((landmarks[LANDMARKS.foreheadCenter].z - landmarks[LANDMARKS.noseTip].z) * 10);
  features.push((landmarks[LANDMARKS.chin].z - landmarks[LANDMARKS.noseTip].z) * 10);
  features.push((landmarks[LANDMARKS.leftCheek].z - landmarks[LANDMARKS.rightCheek].z) * 10);
  features.push((landmarks[LANDMARKS.mouthLeft].z - landmarks[LANDMARKS.mouthRight].z) * 10);
  features.push((landmarks[LANDMARKS.noseTip].z - landmarks[LANDMARKS.chin].z) * 10);

  // Pad or truncate to EMBEDDING_DIMENSION
  const embedding = new Array(EMBEDDING_DIMENSION).fill(0);
  for (let i = 0; i < Math.min(features.length, EMBEDDING_DIMENSION); i++) {
    embedding[i] = features[i];
  }

  // If we have fewer features than needed, create derived features
  if (features.length < EMBEDDING_DIMENSION) {
    // Add polynomial features for remaining slots
    let idx = features.length;
    for (let i = 0; i < features.length && idx < EMBEDDING_DIMENSION; i++) {
      for (let j = i; j < features.length && idx < EMBEDDING_DIMENSION; j++) {
        embedding[idx++] = features[i] * features[j] * 0.5; // Interaction terms
      }
    }
  }

  // L2 normalize the embedding
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

