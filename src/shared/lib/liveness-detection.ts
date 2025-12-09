"use client";

import type { MediaPipeLandmark } from "./mediapipe-face-detection";

interface LivenessFrame {
  timestamp: number;
  landmarks?: MediaPipeLandmark[]; // 468 3D landmarks from MediaPipe
  faceBox?: { x: number; y: number; width: number; height: number };
  depth?: number; // 3D depth information
}

const FRAME_HISTORY_SIZE = 8; // Increased for better 3D analysis
const MIN_FRAMES_FOR_LIVENESS = 3;
const MOVEMENT_THRESHOLD = 1.5;
const BLINK_THRESHOLD = 0.2;
const DEPTH_VARIATION_THRESHOLD = 0.01; // Depth changes indicate 3D face

/**
 * Enhanced liveness detector using MediaPipe 3D face mesh
 * Uses multiple techniques:
 * 1. 3D depth variation (real faces have depth, photos don't)
 * 2. Face movement detection (slight natural movement)
 * 3. Eye blink detection (using 3D landmarks)
 * 4. Face size variation (breathing causes slight size changes)
 * 5. Head pose variation (real faces have natural micro-movements)
 */
export class LivenessDetector {
  private frameHistory: LivenessFrame[] = [];
  private blinkDetected = false;
  private movementScore = 0;
  private depthVariationScore = 0;
  private poseVariationScore = 0;

  /**
   * Add a frame to the history with MediaPipe 3D landmarks
   */
  addFrame(
    landmarks?: MediaPipeLandmark[],
    faceBox?: { x: number; y: number; width: number; height: number }
  ) {
    const depth = landmarks && landmarks.length >= 468 
      ? this.calculateDepth(landmarks)
      : undefined;

    const frame: LivenessFrame = {
      timestamp: Date.now(),
      landmarks,
      faceBox,
      depth,
    };

    this.frameHistory.push(frame);

    // Keep only recent frames
    if (this.frameHistory.length > FRAME_HISTORY_SIZE) {
      this.frameHistory.shift();
    }

    // Analyze liveness with enhanced 3D features
    this.analyzeMovement();
    this.analyzeBlink();
    this.analyzeDepthVariation();
    this.analyzePoseVariation();
  }

  /**
   * Reset the detector
   */
  reset() {
    this.frameHistory = [];
    this.blinkDetected = false;
    this.movementScore = 0;
    this.depthVariationScore = 0;
    this.poseVariationScore = 0;
  }

  /**
   * Check if the face appears to be live (not a photo)
   */
  isLive(): boolean {
    if (this.frameHistory.length < MIN_FRAMES_FOR_LIVENESS) {
      return false; // Not enough frames to determine
    }

    // Multiple indicators: movement, blink, depth variation, or pose variation
    return (
      this.movementScore > 0.3 ||
      this.blinkDetected ||
      this.depthVariationScore > 0.2 ||
      this.poseVariationScore > 0.2
    );
  }

  /**
   * Get liveness confidence (0-1)
   */
  getLivenessScore(): number {
    if (this.frameHistory.length < MIN_FRAMES_FOR_LIVENESS) {
      return 0;
    }

    let score = 0;

    // Movement contributes 25%
    score += Math.min(this.movementScore, 0.25);

    // Blink detection contributes 25%
    if (this.blinkDetected) {
      score += 0.25;
    }

    // Depth variation contributes 25% (3D feature - key for anti-spoofing)
    score += Math.min(this.depthVariationScore, 0.25);

    // Pose variation contributes 25% (3D head movement)
    score += Math.min(this.poseVariationScore, 0.25);

    return Math.min(score, 1);
  }

  /**
   * Analyze face movement between frames
   */
  private analyzeMovement() {
    if (this.frameHistory.length < 2) return;

    const recent = this.frameHistory.slice(-5);
    let totalMovement = 0;
    let comparisons = 0;

    for (let i = 1; i < recent.length; i++) {
      const prev = recent[i - 1];
      const curr = recent[i];

      if (prev.faceBox && curr.faceBox) {
        // Calculate center point movement
        const prevCenterX = prev.faceBox.x + prev.faceBox.width / 2;
        const prevCenterY = prev.faceBox.y + prev.faceBox.height / 2;
        const currCenterX = curr.faceBox.x + curr.faceBox.width / 2;
        const currCenterY = curr.faceBox.y + curr.faceBox.height / 2;

        const movement = Math.sqrt(
          Math.pow(currCenterX - prevCenterX, 2) + 
          Math.pow(currCenterY - prevCenterY, 2)
        );

        // Also check size variation (breathing effect)
        const sizeChange = Math.abs(curr.faceBox.width - prev.faceBox.width);

        if (movement > MOVEMENT_THRESHOLD || sizeChange > 1) {
          totalMovement += movement + sizeChange;
        }
        comparisons++;
      }
    }

    if (comparisons > 0) {
      // Normalize movement score
      this.movementScore = Math.min(totalMovement / (comparisons * 10), 1);
    }
  }

  /**
   * Analyze eye blinks using Eye Aspect Ratio (EAR) with 3D landmarks
   */
  private analyzeBlink() {
    if (this.frameHistory.length < 3) return;

    const recent = this.frameHistory.slice(-5);
    const earValues: number[] = [];

    for (const frame of recent) {
      if (frame.landmarks && frame.landmarks.length >= 468) {
        const ear = this.calculateEAR(frame.landmarks);
        if (ear !== null) {
          earValues.push(ear);
        }
      }
    }

    if (earValues.length < 3) return;

    // Detect blink: EAR drops below threshold then rises back
    for (let i = 1; i < earValues.length - 1; i++) {
      const prev = earValues[i - 1];
      const curr = earValues[i];
      const next = earValues[i + 1];

      // Blink pattern: high -> low -> high
      if (prev > BLINK_THRESHOLD && curr < BLINK_THRESHOLD && next > BLINK_THRESHOLD) {
        this.blinkDetected = true;
        return;
      }
    }
  }

  /**
   * Analyze 3D depth variation (key anti-spoofing feature)
   * Real faces have depth variation, photos/screens don't
   */
  private analyzeDepthVariation() {
    if (this.frameHistory.length < 2) return;

    const recent = this.frameHistory.slice(-6);
    const depths: number[] = [];

    for (const frame of recent) {
      if (frame.depth !== undefined) {
        depths.push(frame.depth);
      }
    }

    if (depths.length < 2) return;

    // Calculate depth variation
    let totalVariation = 0;
    for (let i = 1; i < depths.length; i++) {
      const variation = Math.abs(depths[i] - depths[i - 1]);
      totalVariation += variation;
    }

    // Normalize depth variation score
    // Higher variation = more likely to be a real 3D face
    this.depthVariationScore = Math.min(totalVariation / (depths.length * DEPTH_VARIATION_THRESHOLD), 1);
  }

  /**
   * Analyze head pose variation (3D head movement)
   */
  private analyzePoseVariation() {
    if (this.frameHistory.length < 2) return;

    const recent = this.frameHistory.slice(-5);
    const poses: { pitch: number; yaw: number; roll: number }[] = [];

    for (const frame of recent) {
      if (frame.landmarks && frame.landmarks.length >= 468) {
        const pose = this.estimatePose(frame.landmarks);
        poses.push(pose);
      }
    }

    if (poses.length < 2) return;

    // Calculate pose variation
    let totalVariation = 0;
    for (let i = 1; i < poses.length; i++) {
      const pitchDiff = Math.abs(poses[i].pitch - poses[i - 1].pitch);
      const yawDiff = Math.abs(poses[i].yaw - poses[i - 1].yaw);
      const rollDiff = Math.abs(poses[i].roll - poses[i - 1].roll);
      
      totalVariation += (pitchDiff + yawDiff + rollDiff) / 3;
    }

    // Normalize pose variation score
    this.poseVariationScore = Math.min(totalVariation / (poses.length * 2), 1);
  }

  /**
   * Calculate Eye Aspect Ratio (EAR) using MediaPipe landmarks
   * MediaPipe eye landmarks: left eye (33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246)
   * Right eye (362, 398, 384, 385, 386, 387, 388, 466, 263, 249, 390, 373, 374, 380, 381, 382)
   */
  private calculateEAR(landmarks: MediaPipeLandmark[]): number | null {
    try {
      // Left eye key points (simplified - using 6 points)
      const leftEyeTop = landmarks[159]; // Top of left eye
      const leftEyeBottom = landmarks[145]; // Bottom of left eye
      const leftEyeLeft = landmarks[33]; // Left corner
      const leftEyeRight = landmarks[133]; // Right corner
      const leftEyeInnerTop = landmarks[158];
      const leftEyeInnerBottom = landmarks[153];

      // Right eye key points
      const rightEyeTop = landmarks[386]; // Top of right eye
      const rightEyeBottom = landmarks[374]; // Bottom of right eye
      const rightEyeLeft = landmarks[362]; // Left corner
      const rightEyeRight = landmarks[263]; // Right corner
      const rightEyeInnerTop = landmarks[385];
      const rightEyeInnerBottom = landmarks[380];

      const leftEAR = this.computeEAR(
        leftEyeTop,
        leftEyeBottom,
        leftEyeLeft,
        leftEyeRight,
        leftEyeInnerTop,
        leftEyeInnerBottom
      );

      const rightEAR = this.computeEAR(
        rightEyeTop,
        rightEyeBottom,
        rightEyeLeft,
        rightEyeRight,
        rightEyeInnerTop,
        rightEyeInnerBottom
      );

      return (leftEAR + rightEAR) / 2;
    } catch {
      return null;
    }
  }

  private computeEAR(
    top: MediaPipeLandmark,
    bottom: MediaPipeLandmark,
    left: MediaPipeLandmark,
    right: MediaPipeLandmark,
    innerTop: MediaPipeLandmark,
    innerBottom: MediaPipeLandmark
  ): number {
    const dist = (a: MediaPipeLandmark, b: MediaPipeLandmark) =>
      Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));

    const vertical1 = dist(innerTop, innerBottom);
    const vertical2 = dist(top, bottom);
    const horizontal = dist(left, right);

    return (vertical1 + vertical2) / (2 * horizontal);
  }

  /**
   * Calculate average depth from 3D landmarks
   */
  private calculateDepth(landmarks: MediaPipeLandmark[]): number {
    if (landmarks.length < 468) return 0;

    // Use key facial features for depth calculation
    const keyPoints = [
      landmarks[4],  // Nose tip
      landmarks[33], // Left eye corner
      landmarks[263], // Right eye corner
      landmarks[152], // Chin
      landmarks[10],  // Forehead
    ];

    const avgZ = keyPoints.reduce((sum, point) => sum + Math.abs(point.z), 0) / keyPoints.length;
    return avgZ;
  }

  /**
   * Estimate head pose from landmarks
   */
  private estimatePose(landmarks: MediaPipeLandmark[]): {
    pitch: number;
    yaw: number;
    roll: number;
  } {
    if (landmarks.length < 468) {
      return { pitch: 0, yaw: 0, roll: 0 };
    }

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

    // Calculate pitch (nod) from vertical alignment
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

    // Calculate yaw (turn) from nose position
    const faceCenterX = (leftEye.x + rightEye.x) / 2;
    const yaw = Math.atan2(noseTip.x - faceCenterX, Math.abs(noseTip.z)) * (180 / Math.PI);

    return { pitch: adjustedPitch, yaw, roll };
  }
}

// Singleton instance
let livenessDetector: LivenessDetector | null = null;

export const getLivenessDetector = (): LivenessDetector => {
  if (!livenessDetector) {
    livenessDetector = new LivenessDetector();
  }
  return livenessDetector;
};

export const resetLivenessDetector = () => {
  if (livenessDetector) {
    livenessDetector.reset();
  }
};
