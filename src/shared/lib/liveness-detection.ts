"use client";

import * as faceapi from "face-api.js";

interface LivenessFrame {
  timestamp: number;
  landmarks?: faceapi.FaceLandmarks68;
  faceBox?: { x: number; y: number; width: number; height: number };
}

const FRAME_HISTORY_SIZE = 6;
const MIN_FRAMES_FOR_LIVENESS = 3; // Balanced liveness check
const MOVEMENT_THRESHOLD = 1.5; // Balanced movement sensitivity
const BLINK_THRESHOLD = 0.2; // Eye aspect ratio threshold for blink detection

/**
 * Liveness detector to prevent photo spoofing
 * Uses multiple techniques:
 * 1. Face movement detection (slight natural movement)
 * 2. Eye blink detection
 * 3. Face size variation (breathing causes slight size changes)
 */
export class LivenessDetector {
  private frameHistory: LivenessFrame[] = [];
  private blinkDetected = false;
  private movementScore = 0;

  /**
   * Add a frame to the history
   */
  addFrame(landmarks?: faceapi.FaceLandmarks68, faceBox?: { x: number; y: number; width: number; height: number }) {
    const frame: LivenessFrame = {
      timestamp: Date.now(),
      landmarks,
      faceBox,
    };

    this.frameHistory.push(frame);

    // Keep only recent frames
    if (this.frameHistory.length > FRAME_HISTORY_SIZE) {
      this.frameHistory.shift();
    }

    // Analyze liveness
    this.analyzeMovement();
    this.analyzeBlink();
  }

  /**
   * Reset the detector
   */
  reset() {
    this.frameHistory = [];
    this.blinkDetected = false;
    this.movementScore = 0;
  }

  /**
   * Check if the face appears to be live (not a photo)
   */
  isLive(): boolean {
    if (this.frameHistory.length < MIN_FRAMES_FOR_LIVENESS) {
      return false; // Not enough frames to determine
    }

    // Either movement or blink detected = live
    return this.movementScore > 0.3 || this.blinkDetected;
  }

  /**
   * Get liveness confidence (0-1)
   */
  getLivenessScore(): number {
    if (this.frameHistory.length < MIN_FRAMES_FOR_LIVENESS) {
      return 0;
    }

    let score = 0;

    // Movement contributes 50%
    score += Math.min(this.movementScore, 0.5);

    // Blink detection contributes 50%
    if (this.blinkDetected) {
      score += 0.5;
    }

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
   * Analyze eye blinks using Eye Aspect Ratio (EAR)
   */
  private analyzeBlink() {
    if (this.frameHistory.length < 3) return;

    const recent = this.frameHistory.slice(-5);
    const earValues: number[] = [];

    for (const frame of recent) {
      if (frame.landmarks) {
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
   * Calculate Eye Aspect Ratio (EAR)
   * EAR = (||p2-p6|| + ||p3-p5||) / (2 * ||p1-p4||)
   */
  private calculateEAR(landmarks: faceapi.FaceLandmarks68): number | null {
    try {
      const positions = landmarks.positions;

      // Left eye landmarks (indices 36-41)
      const leftEye = {
        p1: positions[36], p2: positions[37], p3: positions[38],
        p4: positions[39], p5: positions[40], p6: positions[41],
      };

      // Right eye landmarks (indices 42-47)
      const rightEye = {
        p1: positions[42], p2: positions[43], p3: positions[44],
        p4: positions[45], p5: positions[46], p6: positions[47],
      };

      const leftEAR = this.computeEAR(leftEye);
      const rightEAR = this.computeEAR(rightEye);

      return (leftEAR + rightEAR) / 2;
    } catch {
      return null;
    }
  }

  private computeEAR(eye: {
    p1: faceapi.Point; p2: faceapi.Point; p3: faceapi.Point;
    p4: faceapi.Point; p5: faceapi.Point; p6: faceapi.Point;
  }): number {
    const dist = (a: faceapi.Point, b: faceapi.Point) =>
      Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));

    const vertical1 = dist(eye.p2, eye.p6);
    const vertical2 = dist(eye.p3, eye.p5);
    const horizontal = dist(eye.p1, eye.p4);

    return (vertical1 + vertical2) / (2 * horizontal);
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

