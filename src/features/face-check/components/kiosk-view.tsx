"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type { RefObject } from "react";
import { toast } from "@/components/ui/sonner";
import type { FaceMatchResult, Employee } from "@/entities/employee";
import type { FaceCheckPhase, CheckInLogEntry } from "../hooks/use-face-check-view-model";
import type { DetectedFace } from "@/shared/lib/face-embedding";

interface KioskViewProps {
  employees: Employee[];
  detectedEmployee: Employee | null;
  status: {
    phase: FaceCheckPhase;
    isLoadingEmployees: boolean;
    isCameraSupported: boolean;
    isDetecting: boolean;
    modelsReady: boolean;
    livenessScore: number;
    consecutiveMatchCount: number;
    matchInCooldown: boolean;
  };
  videoRef: RefObject<HTMLVideoElement | null>;
  matchResult: FaceMatchResult | null;
  error: string | null;
  detectedFaces: DetectedFace[];
  checkInLogs: CheckInLogEntry[];
  getVideoDimensions: () => { width: number; height: number };
  actions: {
    initializeCamera: () => Promise<void | boolean>;
    startDetection: () => void;
    stopDetection: () => void;
  };
}

export const KioskView = ({
  detectedEmployee,
  status,
  videoRef,
  matchResult,
  detectedFaces,
  checkInLogs,
  getVideoDimensions,
}: KioskViewProps) => {
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastMatchRef = useRef<string | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  
  // Screensaver state
  const [showScreensaver, setShowScreensaver] = useState(false);
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const INACTIVITY_TIMEOUT = 10000;

  // Track recently checked-in employees (to show ✓ on their face)
  const recentCheckInsRef = useRef<Set<string>>(new Set());

  // Smoothed face positions for smooth box following
  interface SmoothedBox { x: number; y: number; w: number; h: number; opacity: number }
  const smoothedBoxesRef = useRef<Map<string, SmoothedBox>>(new Map());
  const SMOOTH_FACTOR = 0.25; // Lower = smoother but more lag, higher = faster but jittery
  const FADE_SPEED = 0.15;

  // Update time every second
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Reset inactivity timer
  const resetInactivityTimer = useCallback(() => {
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    inactivityTimerRef.current = setTimeout(() => setShowScreensaver(true), INACTIVITY_TIMEOUT);
  }, []);

  // Watch for face activity
  useEffect(() => {
    if (detectedFaces.length > 0) {
      if (showScreensaver) {
        setShowScreensaver(false);
      }
      resetInactivityTimer();
    }
  }, [detectedFaces, showScreensaver, resetInactivityTimer]);

  // Start timer when detecting
  useEffect(() => {
    if (status.isDetecting && !showScreensaver) {
      resetInactivityTimer();
    }
    return () => {
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    };
  }, [status.isDetecting, showScreensaver, resetInactivityTimer]);

  // Track check-ins for showing ✓ status
  useEffect(() => {
    if (matchResult && status.phase === "matched" && matchResult.employeeId !== lastMatchRef.current) {
      lastMatchRef.current = matchResult.employeeId;
      recentCheckInsRef.current.add(matchResult.employeeId);
      toast.success(`เช็คชื่อสำเร็จ!`, {
        description: detectedEmployee?.fullName,
        duration: 3000,
      });
      // Clear after 10 seconds
      setTimeout(() => {
        recentCheckInsRef.current.delete(matchResult.employeeId);
      }, 10000);
    }
  }, [matchResult, status.phase, detectedEmployee]);

  useEffect(() => {
    if (status.phase === "detecting") {
      lastMatchRef.current = null;
    }
  }, [status.phase]);

  // Draw face overlay with smooth interpolation
  const drawFaceOverlay = useCallback(() => {
    const canvas = overlayCanvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const containerRect = container.getBoundingClientRect();
    canvas.width = containerRect.width;
    canvas.height = containerRect.height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!status.isDetecting) {
      smoothedBoxesRef.current.clear();
      return;
    }

    const videoDim = getVideoDimensions();
    const scaleX = containerRect.width / videoDim.width;
    const scaleY = containerRect.height / videoDim.height;

    // Track which faces are currently visible
    const currentFaceIds = new Set<string>();

    // Update smoothed positions for detected faces
    for (const face of detectedFaces) {
      if (!face.boundingBox) continue;

      const { x: origX, y: origY, width: origW, height: origH } = face.boundingBox;
      const targetX = origX * scaleX;
      const targetY = origY * scaleY;
      const targetW = origW * scaleX;
      const targetH = origH * scaleY;

      // Use employeeId or generate a position-based key for unknown faces
      const faceKey = face.employeeId || `unknown-${Math.round(origX / 100)}-${Math.round(origY / 100)}`;
      currentFaceIds.add(faceKey);

      const existing = smoothedBoxesRef.current.get(faceKey);
      if (existing) {
        // Smooth interpolation (lerp)
        existing.x += (targetX - existing.x) * SMOOTH_FACTOR;
        existing.y += (targetY - existing.y) * SMOOTH_FACTOR;
        existing.w += (targetW - existing.w) * SMOOTH_FACTOR;
        existing.h += (targetH - existing.h) * SMOOTH_FACTOR;
        existing.opacity = Math.min(1, existing.opacity + FADE_SPEED);
      } else {
        // New face - start at target position
        smoothedBoxesRef.current.set(faceKey, {
          x: targetX, y: targetY, w: targetW, h: targetH, opacity: 0.3
        });
      }
    }

    // Fade out faces that are no longer detected
    for (const [key, box] of smoothedBoxesRef.current.entries()) {
      if (!currentFaceIds.has(key)) {
        box.opacity -= FADE_SPEED;
        if (box.opacity <= 0) {
          smoothedBoxesRef.current.delete(key);
        }
      }
    }

    // Draw all smoothed boxes
    for (const face of detectedFaces) {
      if (!face.boundingBox) continue;

      const faceKey = face.employeeId || `unknown-${Math.round(face.boundingBox.x / 100)}-${Math.round(face.boundingBox.y / 100)}`;
      const smoothed = smoothedBoxesRef.current.get(faceKey);
      if (!smoothed) continue;

      const { x, y, w, h, opacity } = smoothed;
      const { employeeName, employeeId } = face;
      const isCheckedIn = employeeId && recentCheckInsRef.current.has(employeeId);

      // Color based on status with opacity
      let r = 255, g = 255, b = 255, a = 0.5;
      if (isCheckedIn) {
        r = 34; g = 197; b = 94; a = 0.9;
      } else if (employeeName) {
        r = 59; g = 130; b = 246; a = 0.8;
      }
      const color = `rgba(${r}, ${g}, ${b}, ${a * opacity})`;

      // Draw face box
      const radius = 16;
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.shadowColor = color;
      ctx.shadowBlur = 15 * opacity;

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
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Draw label (name or status)
      if ((employeeName || isCheckedIn) && opacity > 0.5) {
        const fontSize = 24;
        ctx.font = `bold ${fontSize}px Inter, system-ui, sans-serif`;
        
        const labelText = isCheckedIn ? `✓ ${employeeName}` : employeeName || "";
        const textMetrics = ctx.measureText(labelText);
        const padding = 12;
        const labelWidth = textMetrics.width + padding * 2;
        const labelHeight = fontSize + padding * 2;
        const labelX = x + (w - labelWidth) / 2;
        const labelY = y - labelHeight - 8;

        // Label background
        ctx.fillStyle = color;
        const labelRadius = 10;
        ctx.beginPath();
        ctx.moveTo(labelX + labelRadius, labelY);
        ctx.lineTo(labelX + labelWidth - labelRadius, labelY);
        ctx.quadraticCurveTo(labelX + labelWidth, labelY, labelX + labelWidth, labelY + labelRadius);
        ctx.lineTo(labelX + labelWidth, labelY + labelHeight - labelRadius);
        ctx.quadraticCurveTo(labelX + labelWidth, labelY + labelHeight, labelX + labelWidth - labelRadius, labelY + labelHeight);
        ctx.lineTo(labelX + labelRadius, labelY + labelHeight);
        ctx.quadraticCurveTo(labelX, labelY + labelHeight, labelX, labelY + labelHeight - labelRadius);
        ctx.lineTo(labelX, labelY + labelRadius);
        ctx.quadraticCurveTo(labelX, labelY, labelX + labelRadius, labelY);
        ctx.closePath();
        ctx.fill();

        // Label text
        ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
        ctx.textBaseline = "top";
        ctx.fillText(labelText, labelX + padding, labelY + padding);
      }
    }
  }, [detectedFaces, getVideoDimensions, status.isDetecting]);

  useEffect(() => {
    drawFaceOverlay();
  }, [drawFaceOverlay]);

  useEffect(() => {
    const handleResize = () => drawFaceOverlay();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [drawFaceOverlay]);

  useEffect(() => {
    if (status.isDetecting) {
      let animationId: number;
      const animate = () => {
        drawFaceOverlay();
        animationId = requestAnimationFrame(animate);
      };
      animationId = requestAnimationFrame(animate);
      return () => cancelAnimationFrame(animationId);
    }
  }, [status.isDetecting, drawFaceOverlay]);

  const dismissScreensaver = () => {
    setShowScreensaver(false);
    resetInactivityTimer();
  };

  return (
    <div className="fixed inset-0 bg-black overflow-hidden">
      <div ref={containerRef} className="absolute inset-0">
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          playsInline
          muted
        />
        
        <canvas
          ref={overlayCanvasRef}
          className="pointer-events-none absolute inset-0 h-full w-full"
        />

        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/50 pointer-events-none" />

        {/* Top bar - time and status */}
        <div className="absolute top-0 left-0 right-0 p-6 flex items-start justify-between">
          <div>
            <div className="text-white/90 text-6xl font-light tracking-tight">
              {currentTime.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
            </div>
            <div className="text-white/60 text-xl mt-1">
              {currentTime.toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long" })}
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {status.modelsReady && (
              <div className="flex items-center gap-2 bg-green-500/20 backdrop-blur-sm rounded-full px-4 py-2">
                <div className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-green-400 text-sm font-medium">AI พร้อม</span>
              </div>
            )}
            {status.isDetecting && (
              <div className="flex items-center gap-2 bg-blue-500/20 backdrop-blur-sm rounded-full px-4 py-2">
                <div className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
                <span className="text-blue-400 text-sm font-medium">กำลังสแกน</span>
              </div>
            )}
          </div>
        </div>

        {/* Simple bottom status */}
        {!showScreensaver && status.isDetecting && detectedFaces.length === 0 && (
          <div className="absolute bottom-20 left-0 right-0 text-center">
            <p className="text-white/70 text-2xl">หันหน้าเข้าหากล้อง</p>
          </div>
        )}

        {/* Loading state */}
        {(!status.modelsReady || status.phase === "loading-employees" || status.phase === "camera-initializing") && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 border-4 border-white/20 border-t-white rounded-full animate-spin mx-auto mb-4" />
              <p className="text-white text-xl">กำลังโหลด...</p>
            </div>
          </div>
        )}

        {/* Screensaver */}
        {showScreensaver && (
          <div 
            className="absolute inset-0 z-50 bg-slate-950/95 flex flex-col items-center justify-center cursor-pointer"
            onClick={dismissScreensaver}
          >
            <div className="text-white/80 text-9xl font-extralight tracking-tight mb-4">
              {currentTime.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
            </div>
            <div className="text-white/40 text-2xl font-light mb-16">
              {currentTime.toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long" })}
            </div>
            <div className="text-white/30 text-xl animate-pulse">
              👆 แตะเพื่อเช็คอิน
            </div>

            {checkInLogs.length > 0 && (
              <div className="absolute bottom-12 left-0 right-0">
                <p className="text-center text-white/20 text-sm mb-4">เช็คอินล่าสุด</p>
                <div className="flex justify-center gap-4">
                  {checkInLogs.slice(0, 5).map((log) => (
                    <div key={log.id} className="flex flex-col items-center">
                      <div className="w-12 h-12 rounded-full bg-slate-800 overflow-hidden ring-2 ring-white/10 flex items-center justify-center text-white/50">
                        {log.employeeName.slice(0, 1)}
                      </div>
                      <span className="text-white/20 text-xs mt-1">{log.employeeName.split(" ")[0]}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Branding */}
        <div className="absolute bottom-6 left-6">
          <div className="text-white/20 text-sm">Face Check-In</div>
        </div>
      </div>
    </div>
  );
};
