export type FaceEmbeddingVersion = "simple-v1" | "faceapi-v1";

export interface FaceEmbedding {
  version: FaceEmbeddingVersion;
  vector: number[];
  createdAt: string;
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
  embedding?: FaceEmbedding;
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
}
