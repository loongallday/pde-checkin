export type FaceEmbeddingVersion = "simple-v1" | "faceapi-v1";

// Angle type for multi-angle enrollment
export type FaceAngle = "front" | "left" | "right" | "slight-left" | "slight-right";

// Single embedding entry with angle information
export interface FaceEmbeddingEntry {
  vector: number[];
  angle: FaceAngle;
  createdAt: string;
  quality?: number; // 0-1 quality score
  imageDataUrl?: string; // Base64 face image captured during enrollment
}

// Legacy single embedding format (for backward compatibility)
export interface FaceEmbedding {
  version: FaceEmbeddingVersion;
  vector: number[];
  createdAt: string;
  source: "camera" | "uploaded";
}

// Multi-embedding format for improved accuracy
export interface FaceEmbeddings {
  version: FaceEmbeddingVersion;
  entries: FaceEmbeddingEntry[];
  averageVector?: number[]; // Pre-computed average for faster matching
  createdAt: string;
  updatedAt: string;
  source: "camera" | "uploaded";
}

export interface Employee {
  id: string;
  fullName: string;
  email: string;
  role: string;
  department?: string;
  avatarUrl?: string;
  lastCheckIn?: string;
  embedding?: FaceEmbedding; // Legacy single embedding (backward compatible)
  embeddings?: FaceEmbeddings; // New multi-embedding format
}

export type FaceMatchStatus = "pending" | "matched" | "mismatch";

export interface FaceMatchResult {
  employeeId: string;
  capturedAt: string;
  snapshotDataUrl: string;
  score: number;
  threshold: number;
  status: FaceMatchStatus;
  message: string;
}

export interface FaceCheckEventPayload {
  employeeId: string;
  capturedAt: string;
  similarityScore: number;
  isMatch: boolean;
  snapshotDataUrl?: string;
  // For progressive learning - embedding captured during check-in
  embeddingVector?: number[];
  embeddingQuality?: number;
  embeddingAngle?: FaceAngle;
}

// Configuration for progressive face learning
export const PROGRESSIVE_LEARNING_CONFIG = {
  MAX_EMBEDDINGS: 20, // Maximum embeddings to store per employee
  MIN_QUALITY_TO_ADD: 0.70, // Minimum quality score to add new embedding
  MIN_SIMILARITY_TO_ADD: 0.75, // Must be a reasonable match to add (75%+)
  REPLACE_THRESHOLD: 0.1, // Replace if new quality is this much better than worst
};

// Database record for face check events
export interface FaceCheckEvent {
  id: string;
  employeeId: string;
  capturedAt: string;
  similarityScore: number;
  isMatch: boolean;
  snapshot?: string;
  createdAt: string;
}