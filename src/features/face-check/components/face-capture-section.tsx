"use client";

import { RefObject, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { FaceCheckPhase } from "../hooks/use-face-check-view-model";
import type { DetectedFace } from "@/shared/lib/face-embedding";

interface FaceCaptureSectionProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  phase: FaceCheckPhase;
  isCameraSupported: boolean;
  isDetecting: boolean;
  detectedFaces?: DetectedFace[];
  getVideoDimensions?: () => { width: number; height: number };
  onInitializeCamera: () => Promise<void | boolean>;
  onStartDetection: () => void;
  onStopDetection: () => void;
}

export const phaseLabel: Record<FaceCheckPhase, string> = {
  idle: "รอเริ่มต้น",
  "loading-employees": "กำลังโหลดข้อมูล",
  "loading-models": "กำลังโหลด AI...",
  "camera-initializing": "กำลังเตรียมกล้อง",
  "camera-ready": "พร้อมตรวจจับ",
  detecting: "🔍 กำลังสแกน...",
  matched: "✓ พบตรงกัน!",
  cooldown: "⏳ รอสักครู่...",
  error: "ข้อผิดพลาด",
};

export const FaceCaptureSection = ({
  videoRef,
  phase,
  isCameraSupported,
  isDetecting,
  detectedFaces = [],
  getVideoDimensions,
  onInitializeCamera,
  onStartDetection,
  onStopDetection,
}: FaceCaptureSectionProps) => {
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isCameraReady = phase === "camera-ready" || phase === "matched" || phase === "cooldown" || phase === "detecting";
  const isProcessing = phase === "camera-initializing" || phase === "loading-models" || phase === "loading-employees";

  // Smoothed face positions
  interface SmoothedBox { x: number; y: number; w: number; h: number; opacity: number }
  const smoothedBoxesRef = useRef<Map<string, SmoothedBox>>(new Map());
  const SMOOTH_FACTOR = 0.25;
  const FADE_SPEED = 0.15;
  const animationRef = useRef<number | null>(null);

  // Draw face bounding boxes with smooth interpolation
  const drawFaceOverlay = useCallback(() => {
    const canvas = overlayCanvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = container.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!getVideoDimensions) return;

    const videoDims = getVideoDimensions();
    const scaleX = rect.width / videoDims.width;
    const scaleY = rect.height / videoDims.height;

    const currentFaceIds = new Set<string>();

    // Update smoothed positions
    for (const face of detectedFaces) {
      const { boundingBox, employeeId } = face;
      const targetX = boundingBox.x * scaleX;
      const targetY = boundingBox.y * scaleY;
      const targetW = boundingBox.width * scaleX;
      const targetH = boundingBox.height * scaleY;

      const faceKey = employeeId || `face-${Math.round(boundingBox.x / 100)}-${Math.round(boundingBox.y / 100)}`;
      currentFaceIds.add(faceKey);

      const existing = smoothedBoxesRef.current.get(faceKey);
      if (existing) {
        existing.x += (targetX - existing.x) * SMOOTH_FACTOR;
        existing.y += (targetY - existing.y) * SMOOTH_FACTOR;
        existing.w += (targetW - existing.w) * SMOOTH_FACTOR;
        existing.h += (targetH - existing.h) * SMOOTH_FACTOR;
        existing.opacity = Math.min(1, existing.opacity + FADE_SPEED);
      } else {
        smoothedBoxesRef.current.set(faceKey, {
          x: targetX, y: targetY, w: targetW, h: targetH, opacity: 0.3
        });
      }
    }

    // Fade out old faces
    for (const [key, box] of smoothedBoxesRef.current.entries()) {
      if (!currentFaceIds.has(key)) {
        box.opacity -= FADE_SPEED;
        if (box.opacity <= 0) smoothedBoxesRef.current.delete(key);
      }
    }

    // Draw faces
    for (const face of detectedFaces) {
      const { boundingBox, employeeName, employeeId } = face;
      const faceKey = employeeId || `face-${Math.round(boundingBox.x / 100)}-${Math.round(boundingBox.y / 100)}`;
      const smoothed = smoothedBoxesRef.current.get(faceKey);
      if (!smoothed) continue;

      const { x, y, w, h, opacity } = smoothed;
      const borderColor = employeeName ? `rgba(34, 197, 94, ${opacity})` : `rgba(59, 130, 246, ${opacity})`;
      const bgColor = employeeName ? `rgba(34, 197, 94, ${0.15 * opacity})` : `rgba(59, 130, 246, ${0.1 * opacity})`;

      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 3;
      ctx.fillStyle = bgColor;
      
      const radius = 12;
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + w - radius, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
      ctx.lineTo(x + w, y + h - radius);
      ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
      ctx.lineTo(x + radius, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Corner accents
      const cornerLength = Math.min(25, w * 0.2, h * 0.2);
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x, y + cornerLength); ctx.lineTo(x, y); ctx.lineTo(x + cornerLength, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + w - cornerLength, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + cornerLength);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y + h - cornerLength); ctx.lineTo(x, y + h); ctx.lineTo(x + cornerLength, y + h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + w - cornerLength, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - cornerLength);
      ctx.stroke();

      if (employeeName && opacity > 0.5) {
        const fontSize = Math.max(16, Math.min(24, w * 0.1));
        ctx.font = `bold ${fontSize}px Inter, system-ui, sans-serif`;
        const textMetrics = ctx.measureText(employeeName);
        const padding = 10;
        const labelX = x;
        const labelY = y - fontSize - padding * 2 - 6;

        ctx.fillStyle = borderColor;
        const labelRadius = 8;
        ctx.beginPath();
        ctx.moveTo(labelX + labelRadius, labelY);
        ctx.lineTo(labelX + textMetrics.width + padding * 2 - labelRadius, labelY);
        ctx.quadraticCurveTo(labelX + textMetrics.width + padding * 2, labelY, labelX + textMetrics.width + padding * 2, labelY + labelRadius);
        ctx.lineTo(labelX + textMetrics.width + padding * 2, labelY + fontSize + padding * 2 - labelRadius);
        ctx.quadraticCurveTo(labelX + textMetrics.width + padding * 2, labelY + fontSize + padding * 2, labelX + textMetrics.width + padding * 2 - labelRadius, labelY + fontSize + padding * 2);
        ctx.lineTo(labelX + labelRadius, labelY + fontSize + padding * 2);
        ctx.quadraticCurveTo(labelX, labelY + fontSize + padding * 2, labelX, labelY + fontSize + padding * 2 - labelRadius);
        ctx.lineTo(labelX, labelY + labelRadius);
        ctx.quadraticCurveTo(labelX, labelY, labelX + labelRadius, labelY);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
        ctx.textBaseline = "top";
        ctx.fillText(employeeName, labelX + padding, labelY + padding);
      }
    }
  }, [detectedFaces, getVideoDimensions]);

  // Animation loop for smooth rendering
  useEffect(() => {
    if (isDetecting) {
      const animate = () => {
        drawFaceOverlay();
        animationRef.current = requestAnimationFrame(animate);
      };
      animationRef.current = requestAnimationFrame(animate);
      return () => {
        if (animationRef.current) cancelAnimationFrame(animationRef.current);
      };
    } else {
      smoothedBoxesRef.current.clear();
      drawFaceOverlay();
    }
  }, [isDetecting, drawFaceOverlay]);

  useEffect(() => {
    const handleResize = () => drawFaceOverlay();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [drawFaceOverlay]);

  const getBadgeVariant = () => {
    if (phase === "matched" || phase === "cooldown") return "default";
    if (phase === "error") return "destructive";
    if (phase === "detecting") return "outline";
    return "secondary";
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-lg">กล้องเช็คชื่อ</CardTitle>
          <CardDescription>เดินผ่านหน้ากล้องเพื่อเช็คชื่ออัตโนมัติ</CardDescription>
        </div>
        <Badge 
          variant={getBadgeVariant()}
          className={cn(
            "text-sm",
            phase === "detecting" && "animate-pulse bg-blue-100 text-blue-700 border-blue-300",
            phase === "matched" && "bg-green-500",
            phase === "cooldown" && "bg-yellow-500"
          )}
        >
          {phaseLabel[phase]}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3 pt-2">
        {!isCameraSupported ? (
          <Alert variant="destructive">
            <AlertTitle>ไม่สามารถใช้กล้องได้</AlertTitle>
            <AlertDescription>
              อุปกรณ์นี้ไม่สามารถเข้าถึงกล้องได้
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-3">
            <div 
              ref={containerRef}
              className="relative aspect-video w-full overflow-hidden rounded-xl border-2 border-muted bg-black"
            >
              <video
                ref={videoRef}
                className={cn(
                  "h-full w-full object-cover",
                  !isCameraReady && "opacity-50 grayscale"
                )}
                playsInline
                muted
              />
              
              {/* Face overlay canvas */}
              <canvas
                ref={overlayCanvasRef}
                className="pointer-events-none absolute inset-0 h-full w-full"
              />
              
              {/* Loading/Initializing overlay */}
              {isProcessing && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 text-white">
                  <div className="h-12 w-12 animate-spin rounded-full border-4 border-white/30 border-t-white" />
                  <p className="mt-4 text-sm font-medium">{phaseLabel[phase]}</p>
                </div>
              )}
              
              {/* Scanning animation when detecting but no face */}
              {isDetecting && detectedFaces.length === 0 && !isProcessing && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="relative">
                    <div className="h-48 w-48 rounded-full border-4 border-dashed border-blue-400/50 animate-spin" style={{ animationDuration: "4s" }} />
                    <div className="absolute inset-4 rounded-full border-4 border-blue-400/30 animate-pulse" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-blue-400 text-sm font-medium">กรุณาหันหน้าเข้าหากล้อง</span>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Status indicator */}
              {isDetecting && detectedFaces.length > 0 && (
                <div className="absolute bottom-3 left-3">
                  <div className="rounded-full bg-green-500/90 px-3 py-1.5 text-xs font-medium text-white shadow-lg flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
                    ตรวจพบใบหน้า {detectedFaces.length > 1 ? `(${detectedFaces.length})` : ""}
                  </div>
                </div>
              )}
              
              {/* Cooldown overlay */}
              {phase === "cooldown" && (
                <div className="absolute inset-0 flex items-center justify-center bg-green-500/20">
                  <div className="text-center">
                    <div className="text-6xl mb-2">✓</div>
                    <p className="text-white text-lg font-bold drop-shadow-lg">เช็คชื่อสำเร็จ!</p>
                    <p className="text-white/80 text-sm">กลับไปสแกนใน 5 วินาที...</p>
                  </div>
                </div>
              )}
            </div>
            
            {/* Manual controls - minimal since we auto-start */}
            <div className="flex flex-wrap gap-2">
              {!isCameraReady && !isProcessing && (
                <Button 
                  onClick={() => void onInitializeCamera()} 
                  size="sm"
                  className="flex-1"
                >
                  เริ่มกล้อง
                </Button>
              )}
              {isCameraReady && !isDetecting && phase !== "cooldown" && (
                <Button 
                  onClick={onStartDetection} 
                  size="sm"
                  className="flex-1"
                >
                  เริ่มตรวจจับ
                </Button>
              )}
              {isDetecting && (
                <Button 
                  onClick={onStopDetection} 
                  variant="outline"
                  size="sm"
                >
                  หยุด
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
