import { normalizeVector } from "./math";

const EMBEDDING_SIZE = 16;

export interface FrameCaptureResult {
  dataUrl: string;
  embedding: number[];
}

const assertBrowser = () => {
  if (typeof window === "undefined") {
    throw new Error("เครื่องมือจับภาพใบหน้าสามารถทำงานได้เฉพาะในเบราว์เซอร์เท่านั้น");
  }
};

const createWorkingCanvas = (width: number, height: number) => {
  assertBrowser();

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    throw new Error("ไม่สามารถเตรียม canvas context สำหรับการจับภาพใบหน้าได้");
  }

  return { canvas, context };
};

const imageDataToEmbedding = (imageData: ImageData): number[] => {
  const { data, width, height } = imageData;
  const bucketWidth = Math.max(1, Math.floor(width / EMBEDDING_SIZE));
  const bucketHeight = Math.max(1, Math.floor(height / EMBEDDING_SIZE));
  const vector: number[] = [];

  for (let y = 0; y < EMBEDDING_SIZE; y += 1) {
    for (let x = 0; x < EMBEDDING_SIZE; x += 1) {
      let sum = 0;
      let count = 0;
      const startX = x * bucketWidth;
      const startY = y * bucketHeight;

      for (let yy = startY; yy < Math.min(startY + bucketHeight, height); yy += 1) {
        for (let xx = startX; xx < Math.min(startX + bucketWidth, width); xx += 1) {
          const idx = (yy * width + xx) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
          sum += luminance;
          count += 1;
        }
      }

      vector.push(count ? sum / count : 0);
    }
  }

  return normalizeVector(vector);
};

export const captureEmbeddingFromVideo = (
  video: HTMLVideoElement,
  options?: { width?: number; height?: number; jpegQuality?: number },
): FrameCaptureResult => {
  if (!video) {
    throw new Error("สตรีมกล้องยังไม่พร้อม");
  }

  const width = options?.width ?? video.videoWidth ?? 640;
  const height = options?.height ?? video.videoHeight ?? 640;
  const jpegQuality = options?.jpegQuality ?? 0.85;

  const { canvas, context } = createWorkingCanvas(width, height);
  context.drawImage(video, 0, 0, width, height);

  const imageData = context.getImageData(0, 0, width, height);
  const embedding = imageDataToEmbedding(imageData);
  const dataUrl = canvas.toDataURL("image/jpeg", jpegQuality);

  return { dataUrl, embedding };
};

export const FACE_MATCH_THRESHOLD = 0.88;
