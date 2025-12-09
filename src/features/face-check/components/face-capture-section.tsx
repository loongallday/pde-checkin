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
  livenessScore?: number;
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
  capturing: "กำลังถ่ายภาพ",
  verifying: "กำลังตรวจสอบ",
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
  livenessScore = 0,
  onInitializeCamera,
  onStartDetection,
  onStopDetection,
}: FaceCaptureSectionProps) => {
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isCameraReady = phase === "camera-ready" || phase === "matched" || phase === "cooldown" || phase === "detecting";
  const isProcessing = phase === "camera-initializing" || phase === "capturing" || phase === "verifying" || phase === "loading-models" || phase === "loading-employees";

  // Draw face bounding boxes on overlay canvas
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

    if (detectedFaces.length === 0 || !getVideoDimensions) return;

    const videoDims = getVideoDimensions();
    const scaleX = rect.width / videoDims.width;
    const scaleY = rect.height / videoDims.height;

    for (const face of detectedFaces) {
      const { boundingBox, employeeName, matchScore } = face;
      
      const x = boundingBox.x * scaleX;
      const y = boundingBox.y * scaleY;
      const w = boundingBox.width * scaleX;
      const h = boundingBox.height * scaleY;

      const hasMatch = employeeName && matchScore && matchScore >= 0.7;
      const borderColor = hasMatch ? "#22c55e" : "#3b82f6";
      const bgColor = hasMatch ? "rgba(34, 197, 94, 0.15)" : "rgba(59, 130, 246, 0.1)";

      // Draw face bounding box
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

      // Draw corner accents
      const cornerLength = Math.min(25, w * 0.2, h * 0.2);
      ctx.lineWidth = 5;
      ctx.lineCap = "round";

      // Top-left corner
      ctx.beginPath();
      ctx.moveTo(x, y + cornerLength);
      ctx.lineTo(x, y);
      ctx.lineTo(x + cornerLength, y);
      ctx.stroke();

      // Top-right corner
      ctx.beginPath();
      ctx.moveTo(x + w - cornerLength, y);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x + w, y + cornerLength);
      ctx.stroke();

      // Bottom-left corner
      ctx.beginPath();
      ctx.moveTo(x, y + h - cornerLength);
      ctx.lineTo(x, y + h);
      ctx.lineTo(x + cornerLength, y + h);
      ctx.stroke();

      // Bottom-right corner
      ctx.beginPath();
      ctx.moveTo(x + w - cornerLength, y + h);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x + w, y + h - cornerLength);
      ctx.stroke();

      // Draw name label if available
      if (employeeName) {
        const fontSize = Math.max(16, Math.min(24, w * 0.1));
        ctx.font = `bold ${fontSize}px Inter, system-ui, sans-serif`;
        
        const scoreText = matchScore ? ` ${Math.round(matchScore * 100)}%` : "";
        const labelText = employeeName + scoreText;
        const textMetrics = ctx.measureText(labelText);
        const textWidth = textMetrics.width;
        const textHeight = fontSize;
        const padding = 10;
        const labelX = x;
        const labelY = y - textHeight - padding * 2 - 6;

        // Label background
        ctx.fillStyle = borderColor;
        ctx.beginPath();
        const labelRadius = 8;
        ctx.moveTo(labelX + labelRadius, labelY);
        ctx.lineTo(labelX + textWidth + padding * 2 - labelRadius, labelY);
        ctx.quadraticCurveTo(labelX + textWidth + padding * 2, labelY, labelX + textWidth + padding * 2, labelY + labelRadius);
        ctx.lineTo(labelX + textWidth + padding * 2, labelY + textHeight + padding * 2 - labelRadius);
        ctx.quadraticCurveTo(labelX + textWidth + padding * 2, labelY + textHeight + padding * 2, labelX + textWidth + padding * 2 - labelRadius, labelY + textHeight + padding * 2);
        ctx.lineTo(labelX + labelRadius, labelY + textHeight + padding * 2);
        ctx.quadraticCurveTo(labelX, labelY + textHeight + padding * 2, labelX, labelY + textHeight + padding * 2 - labelRadius);
        ctx.lineTo(labelX, labelY + labelRadius);
        ctx.quadraticCurveTo(labelX, labelY, labelX + labelRadius, labelY);
        ctx.closePath();
        ctx.fill();

        // Label text
        ctx.fillStyle = "#ffffff";
        ctx.textBaseline = "top";
        ctx.fillText(labelText, labelX + padding, labelY + padding);
      }
    }
  }, [detectedFaces, getVideoDimensions]);

  useEffect(() => {
    drawFaceOverlay();
  }, [drawFaceOverlay]);

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
              
              {/* Status indicators */}
              <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
                {/* Face detected indicator */}
                {isDetecting && detectedFaces.length > 0 && (
                  <div className="rounded-full bg-green-500/90 px-3 py-1.5 text-xs font-medium text-white shadow-lg flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
                    ตรวจพบใบหน้า
                  </div>
                )}
                
                {/* Liveness indicator */}
                {isDetecting && detectedFaces.length > 0 && (
                  <div className="rounded-full bg-black/60 px-3 py-1.5 text-xs text-white shadow-lg flex items-center gap-2">
                    <span>ความปลอดภัย</span>
                    <div className="w-12 h-1.5 bg-white/30 rounded-full overflow-hidden">
                      <div 
                        className={cn(
                          "h-full rounded-full transition-all duration-300",
                          livenessScore >= 0.5 ? "bg-green-400" : "bg-yellow-400"
                        )}
                        style={{ width: `${livenessScore * 100}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
              
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
