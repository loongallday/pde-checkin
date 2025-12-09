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
  onInitializeCamera: () => Promise<void> | void;
  onStartDetection: () => void;
  onStopDetection: () => void;
}

export const phaseLabel: Record<FaceCheckPhase, string> = {
  idle: "พร้อม",
  "loading-employees": "กำลังโหลดข้อมูลพนักงาน",
  "loading-models": "กำลังโหลด AI Models...",
  "camera-initializing": "กำลังเตรียมกล้อง",
  "camera-ready": "กล้องพร้อมใช้งาน",
  detecting: "กำลังตรวจจับใบหน้า (AI)",
  capturing: "กำลังถ่ายภาพ",
  verifying: "กำลังตรวจสอบใบหน้า",
  matched: "พบความตรงกัน",
  mismatch: "ตรวจพบความไม่ตรงกัน",
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
  const isCameraReady = phase === "camera-ready" || phase === "matched" || phase === "mismatch" || phase === "detecting";
  const isProcessing = phase === "camera-initializing" || phase === "capturing" || phase === "verifying";

  // Draw face bounding boxes on overlay canvas
  const drawFaceOverlay = useCallback(() => {
    const canvas = overlayCanvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Get container dimensions
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    // Clear previous drawings
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (detectedFaces.length === 0 || !getVideoDimensions) return;

    const videoDims = getVideoDimensions();
    const scaleX = rect.width / videoDims.width;
    const scaleY = rect.height / videoDims.height;

    for (const face of detectedFaces) {
      const { boundingBox, employeeName, matchScore } = face;
      
      // Scale coordinates to canvas
      const x = boundingBox.x * scaleX;
      const y = boundingBox.y * scaleY;
      const w = boundingBox.width * scaleX;
      const h = boundingBox.height * scaleY;

      // Determine color based on match status
      const hasMatch = employeeName && matchScore && matchScore >= 0.7;
      const borderColor = hasMatch ? "#22c55e" : "#3b82f6"; // green if matched, blue otherwise
      const bgColor = hasMatch ? "rgba(34, 197, 94, 0.15)" : "rgba(59, 130, 246, 0.1)";

      // Draw face bounding box
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 3;
      ctx.fillStyle = bgColor;
      
      // Rounded rectangle
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
      const cornerLength = Math.min(20, w * 0.15, h * 0.15);
      ctx.lineWidth = 4;
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
        const fontSize = Math.max(14, Math.min(20, w * 0.08));
        ctx.font = `bold ${fontSize}px Inter, system-ui, sans-serif`;
        
        const scoreText = matchScore ? ` ${Math.round(matchScore * 100)}%` : "";
        const labelText = employeeName + scoreText;
        const textMetrics = ctx.measureText(labelText);
        const textWidth = textMetrics.width;
        const textHeight = fontSize;
        const padding = 8;
        const labelX = x;
        const labelY = y - textHeight - padding * 2 - 4;

        // Label background
        ctx.fillStyle = borderColor;
        ctx.beginPath();
        const labelRadius = 6;
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

  // Update overlay when faces change
  useEffect(() => {
    drawFaceOverlay();
  }, [drawFaceOverlay]);

  // Handle resize
  useEffect(() => {
    const handleResize = () => drawFaceOverlay();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [drawFaceOverlay]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>กล้องถ่ายทอดสด</CardTitle>
          <CardDescription>เริ่มกล้องแล้วกดตรวจจับเพื่อค้นหาพนักงานอัตโนมัติ</CardDescription>
        </div>
        <Badge 
          variant={phase === "matched" ? "default" : phase === "mismatch" ? "destructive" : phase === "detecting" ? "outline" : "secondary"}
          className={cn(phase === "detecting" && "animate-pulse")}
        >
          {phaseLabel[phase]}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isCameraSupported ? (
          <Alert variant="destructive">
            <AlertTitle>ไม่สามารถใช้กล้องได้</AlertTitle>
            <AlertDescription>
              อุปกรณ์นี้ไม่สามารถเข้าถึงกล้องได้ กรุณาเชื่อมต่อเว็บแคมหรือใช้อุปกรณ์มือถือเพื่อทำการเช็คชื่อ
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4">
            <div 
              ref={containerRef}
              className="relative aspect-[3/2] w-full overflow-hidden rounded-xl border bg-muted"
            >
              <video
                ref={videoRef}
                className={cn("h-full w-full object-cover", !isCameraReady && "opacity-80 grayscale")}
                playsInline
                muted
              />
              {/* Face overlay canvas */}
              <canvas
                ref={overlayCanvasRef}
                className="pointer-events-none absolute inset-0 h-full w-full"
              />
              {!isCameraReady ? (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                  กล้องยังไม่พร้อมใช้งาน
                </div>
              ) : null}
              {isDetecting && detectedFaces.length === 0 ? (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="rounded-full border-4 border-primary/50 p-8 animate-pulse">
                    <div className="h-32 w-32 rounded-full border-4 border-dashed border-primary animate-spin" style={{ animationDuration: "3s" }} />
                  </div>
                </div>
              ) : null}
              {/* Face detection indicator */}
              {isDetecting && detectedFaces.length > 0 && (
                <div className="absolute bottom-3 left-3 rounded-full bg-green-500/90 px-3 py-1 text-xs font-medium text-white shadow-lg">
                  ตรวจพบใบหน้า
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-3">
              <Button onClick={onInitializeCamera} disabled={isProcessing || isDetecting} variant="outline">
                {isCameraReady ? "เริ่มกล้องใหม่" : "เริ่มกล้อง"}
              </Button>
              {isDetecting ? (
                <Button onClick={onStopDetection} variant="destructive">
                  หยุดตรวจจับ
                </Button>
              ) : (
                <Button 
                  onClick={onStartDetection} 
                  disabled={!isCameraReady || isProcessing || phase === "matched"}
                >
                  {isProcessing ? "กำลังประมวลผล" : "เริ่มตรวจจับใบหน้า"}
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
