"use client";

import { FaceLandmarker, FilesetResolver, DrawingUtils } from "@mediapipe/tasks-vision";

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MediaPipeLandmark {
  x: number;
  y: number;
  z: number;
}

export interface DetectionResult {
  box: FaceBox;
  score: number;
  landmarks?: MediaPipeLandmark[]; // 468 3D landmarks
  faceMesh?: MediaPipeLandmark[]; // Full face mesh
}

// Model loading state
let faceLandmarker: FaceLandmarker | null = null;
let modelsLoaded = false;
let modelsLoading = false;
let modelLoadError: string | null = null;

// Track last timestamp for MediaPipe (must be monotonically increasing)
let lastTimestampMs = 0;

/**
 * Load MediaPipe Face Landmarker models
 */
export const loadMediaPipeModels = async (): Promise<boolean> => {
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
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
    );

    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
        delegate: "GPU", // Will fallback to CPU if GPU not available (that's the INFO message)
      },
      outputFaceBlendshapes: false,
      runningMode: "VIDEO",
      numFaces: 1,
    });

    // Verify the landmarker was created successfully
    if (!faceLandmarker) {
      throw new Error("FaceLandmarker creation returned null");
    }

    modelsLoaded = true;
    console.log("✅ MediaPipe face detection models loaded successfully");
    return true;
  } catch (error) {
    modelLoadError = error instanceof Error ? error.message : "Failed to load MediaPipe models";
    console.error("❌ Failed to load MediaPipe models:", error);
    return false;
  } finally {
    modelsLoading = false;
  }
};

/**
 * Check if models are loaded
 */
export const areMediaPipeModelsLoaded = (): boolean => modelsLoaded;

/**
 * Get model loading error
 */
export const getMediaPipeModelLoadError = (): string | null => modelLoadError;

// Detection confidence thresholds
export const MEDIAPIPE_CONFIG = {
  MIN_CONFIDENCE: 0.5, // Minimum confidence for face detection
  MIN_VISIBILITY: 0.5, // Minimum visibility for landmarks
};

/**
 * Detect faces in a video element using MediaPipe
 */
export const detectFacesWithMediaPipe = async (
  video: HTMLVideoElement
): Promise<DetectionResult[]> => {
  if (!modelsLoaded) {
    const loaded = await loadMediaPipeModels();
    if (!loaded || !faceLandmarker) return [];
  }

  if (!faceLandmarker) return [];

  // Validate video element is ready
  if (video.readyState < 2) {
    console.warn("Video element not ready, readyState:", video.readyState);
    return [];
  }

  // Validate video dimensions
  const videoWidth = video.videoWidth || 0;
  const videoHeight = video.videoHeight || 0;
  if (videoWidth === 0 || videoHeight === 0) {
    console.warn("Video element has invalid dimensions:", { videoWidth, videoHeight });
    return [];
  }

  try {
    const startTimeMs = performance.now();
    let results;
    try {
      results = faceLandmarker.detectForVideo(video, startTimeMs);
    } catch (detectError) {
      console.error("Error calling detectForVideo:", detectError);
      console.error("Video element state:", {
        readyState: video.readyState,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        width: video.width,
        height: video.height,
      });
      return [];
    }

    if (!results.faceLandmarks || results.faceLandmarks.length === 0) {
      return [];
    }

    return results.faceLandmarks.map((landmarks, index) => {
      // Calculate bounding box from landmarks
      const xs = landmarks.map((lm) => lm.x * video.videoWidth);
      const ys = landmarks.map((lm) => lm.y * video.videoHeight);
      
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);

      const box: FaceBox = {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      };

      // Convert landmarks to our format
      const landmarks3D: MediaPipeLandmark[] = landmarks.map((lm) => ({
        x: lm.x * video.videoWidth,
        y: lm.y * video.videoHeight,
        z: lm.z * (video.videoWidth + video.videoHeight) / 2, // Normalize z
      }));

      // Use face detection score if available, otherwise estimate from landmark confidence
      const score = results.faceBlendshapes?.[index] 
        ? 0.9 // High confidence if blendshapes are available
        : 0.8; // Default confidence

      return {
        box,
        score,
        landmarks: landmarks3D,
        faceMesh: landmarks3D, // Full 468-point mesh
      };
    });
  } catch (error) {
    console.error("MediaPipe face detection error:", error);
    return [];
  }
};

/**
 * Detect single face with full landmarks (for enrollment/matching)
 */
export const detectSingleFaceWithMediaPipe = async (
  input: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement
): Promise<DetectionResult | null> => {
  // Wrap entire function in try-catch to prevent any uncaught errors
  try {
    if (!modelsLoaded) {
      const loaded = await loadMediaPipeModels();
      if (!loaded || !faceLandmarker) return null;
    }

    if (!faceLandmarker) return null;
    // Convert input to video element if needed
    let videoElement: HTMLVideoElement;
    if (input instanceof HTMLVideoElement) {
      videoElement = input;
    } else {
      // For canvas/image, we need to create a temporary video or use IMAGE mode
      // For now, we'll use the image directly
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;

      if (input instanceof HTMLImageElement) {
        canvas.width = input.width;
        canvas.height = input.height;
        ctx.drawImage(input, 0, 0);
      } else if (input instanceof HTMLCanvasElement) {
        canvas.width = input.width;
        canvas.height = input.height;
        ctx.drawImage(input, 0, 0);
      } else {
        return null;
      }

      // Use IMAGE mode for static images
      // Note: We'd need to recreate the landmarker in IMAGE mode, but for simplicity
      // we'll use the video element approach
      const tempVideo = document.createElement("video");
      tempVideo.width = canvas.width;
      tempVideo.height = canvas.height;
      tempVideo.srcObject = null;
      // For now, return null for non-video inputs - we can enhance this later
      return null;
    }

    // Validate video element is ready
    if (videoElement.readyState < 2) {
      console.warn("Video element not ready, readyState:", videoElement.readyState);
      return null;
    }

    // Validate video dimensions
    const videoWidth = videoElement.videoWidth || 0;
    const videoHeight = videoElement.videoHeight || 0;
    if (videoWidth === 0 || videoHeight === 0) {
      console.warn("Video element has invalid dimensions:", { videoWidth, videoHeight });
      return null;
    }

    // MediaPipe requires monotonically increasing timestamps
    const currentTimeMs = performance.now();
    const startTimeMs = Math.max(currentTimeMs, lastTimestampMs + 1);
    lastTimestampMs = startTimeMs;
    
    // Ensure faceLandmarker is still valid
    if (!faceLandmarker) {
      console.error("[MediaPipe] FaceLandmarker is null");
      return null;
    }

    // Double-check video element is still valid right before calling
    if (!videoElement) {
      console.warn("[MediaPipe] Video element is null");
      return null;
    }

    // Check readyState - must be at least HAVE_CURRENT_DATA (2)
    if (videoElement.readyState < 2) {
      console.warn("[MediaPipe] Video element not ready, readyState:", videoElement.readyState);
      return null;
    }

    // Check if video element has valid dimensions
    const finalVideoWidth = videoElement.videoWidth || 0;
    const finalVideoHeight = videoElement.videoHeight || 0;
    if (finalVideoWidth === 0 || finalVideoHeight === 0) {
      console.warn("[MediaPipe] Video dimensions invalid:", { finalVideoWidth, finalVideoHeight });
      return null;
    }

    // Check if video element is connected to DOM (MediaPipe may require this)
    if (!videoElement.isConnected) {
      console.warn("[MediaPipe] Video element not connected to DOM");
      return null;
    }

    // Ensure faceLandmarker is still valid (race condition check)
    if (!faceLandmarker) {
      console.error("[MediaPipe] FaceLandmarker became null before detectForVideo");
      return null;
    }

    console.log("[MediaPipe] Calling detectForVideo", {
      readyState: videoElement.readyState,
      videoWidth: finalVideoWidth,
      videoHeight: finalVideoHeight,
      isConnected: videoElement.isConnected,
    });

    let results;
    try {
      const detectStart = performance.now();
      
      // Call detectForVideo - wrap in immediate try-catch to catch any synchronous errors
      // MediaPipe may throw if video element is in an invalid state
      try {
        results = faceLandmarker.detectForVideo(videoElement, startTimeMs);
      } catch (immediateError) {
        // Catch any immediate synchronous errors
        const errorMsg = immediateError instanceof Error ? immediateError.message : String(immediateError);
        // Don't log as error - this is expected in some cases
        console.debug("[MediaPipe] detectForVideo immediate error (suppressed):", errorMsg);
        return null;
      }
      
      const detectDuration = performance.now() - detectStart;
      console.log("[MediaPipe] detectForVideo completed", {
        duration: `${detectDuration.toFixed(2)}ms`,
        hasResults: !!results,
        landmarksCount: results?.faceLandmarks?.length || 0,
      });
    } catch (detectError) {
      // Suppress the error from propagating - it's already handled
      // MediaPipe may log errors internally, but we catch and handle them here
      const errorMessage = detectError instanceof Error ? detectError.message : String(detectError);
      
      // Only log if it's not a known MediaPipe internal error
      // The "INFO: Created TensorFlow Lite XNNPACK delegate" is just a log, not an error
      if (!errorMessage.includes("TensorFlow Lite") && !errorMessage.includes("XNNPACK")) {
        console.debug("[MediaPipe] detectForVideo error (handled and suppressed):", errorMessage);
      }
      
      // Return null gracefully - don't throw
      return null;
    }

    if (!results.faceLandmarks || results.faceLandmarks.length === 0) {
      return null;
    }

    // Get first face
    const landmarks = results.faceLandmarks[0];

    // Calculate bounding box
    const xs = landmarks.map((lm) => lm.x * videoElement.videoWidth);
    const ys = landmarks.map((lm) => lm.y * videoElement.videoHeight);
    
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const box: FaceBox = {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };

    const landmarks3D: MediaPipeLandmark[] = landmarks.map((lm) => ({
      x: lm.x * videoElement.videoWidth,
      y: lm.y * videoElement.videoHeight,
      z: lm.z * (videoElement.videoWidth + videoElement.videoHeight) / 2,
    }));

    return {
      box,
      score: 0.9,
      landmarks: landmarks3D,
      faceMesh: landmarks3D,
    };
  } catch (error) {
    // Catch any errors that might have escaped inner try-catch blocks
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    // Only log if it's not a handled error (avoid duplicate logs)
    if (!errorMessage.includes("detectForVideo")) {
      console.error("[MediaPipe] Unhandled error in detectSingleFaceWithMediaPipe:", errorMessage);
      if (errorStack) {
        console.error("[MediaPipe] Stack trace:", errorStack);
      }
    }
    return null;
  }
};

/**
 * Get head pose (pitch, yaw, roll) from MediaPipe landmarks
 */
export const estimateHeadPose = (landmarks: MediaPipeLandmark[]): {
  pitch: number; // Nodding up/down
  yaw: number; // Turning left/right
  roll: number; // Tilting left/right
} => {
  if (landmarks.length < 468) {
    return { pitch: 0, yaw: 0, roll: 0 };
  }

  // Key landmarks for pose estimation
  // Nose tip (index 4)
  // Left eye corner (index 33)
  // Right eye corner (index 263)
  // Chin (index 152)
  // Forehead (index 10)

  const noseTip = landmarks[4];
  const leftEye = landmarks[33];
  const rightEye = landmarks[263];
  const chin = landmarks[152];
  const forehead = landmarks[10];

  // Calculate roll (tilt) from eye alignment
  const eyeVector = {
    x: rightEye.x - leftEye.x,
    y: rightEye.y - leftEye.y,
  };
  const roll = Math.atan2(eyeVector.y, eyeVector.x) * (180 / Math.PI);

  // Calculate pitch (nod) from nose to forehead/chin
  // Pitch: 90° = straight (looking forward), >90° = looking up, <90° = looking down
  const verticalVector = {
    x: forehead.x - chin.x,
    y: forehead.y - chin.y,
    z: forehead.z - chin.z,
  };
  // Calculate angle from vertical (90° when straight)
  const pitchRad = Math.atan2(Math.sqrt(verticalVector.x ** 2 + verticalVector.z ** 2), Math.abs(verticalVector.y));
  const pitch = 90 - (pitchRad * (180 / Math.PI));
  // Adjust sign based on direction (positive = up, negative = down)
  const pitchSign = verticalVector.y < 0 ? 1 : -1;
  const adjustedPitch = pitch * pitchSign;

  // Calculate yaw (turn) from nose position relative to face center
  // Note: Camera is flipped horizontally, so we negate yaw to match user's perspective
  const faceCenterX = (leftEye.x + rightEye.x) / 2;
  const yaw = Math.atan2(noseTip.x - faceCenterX, Math.abs(noseTip.z)) * (180 / Math.PI);
  // Negate yaw because camera feed is mirrored (flipped horizontally)
  const flippedYaw = -yaw;

  return { pitch: adjustedPitch, yaw: flippedYaw, roll };
};

/**
 * Calculate depth from MediaPipe landmarks (for liveness detection)
 */
export const calculateFaceDepth = (landmarks: MediaPipeLandmark[]): number => {
  if (landmarks.length < 468) return 0;

  // Use z-coordinates of key facial features
  const keyPoints = [
    landmarks[4],  // Nose tip
    landmarks[33], // Left eye corner
    landmarks[263], // Right eye corner
    landmarks[152], // Chin
  ];

  const avgZ = keyPoints.reduce((sum, point) => sum + point.z, 0) / keyPoints.length;
  return avgZ;
};

