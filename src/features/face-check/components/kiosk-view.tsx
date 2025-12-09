"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type { RefObject } from "react";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/sonner";
import type { FaceMatchResult, Employee } from "@/entities/employee";
import type { FaceCheckPhase, CheckInLogEntry } from "../hooks/use-face-check-view-model";
import { ACCURACY_CONFIG, type DetectedFace } from "@/shared/lib/face-embedding";

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
  error,
  detectedFaces,
  checkInLogs,
  getVideoDimensions,
  actions,
}: KioskViewProps) => {
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastMatchRef = useRef<string | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  
  // Simple screensaver state - controlled by a single timer
  const [showScreensaver, setShowScreensaver] = useState(false);
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const INACTIVITY_TIMEOUT = 10000; // 10 seconds

  // Update time every second
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Reset inactivity timer whenever there's activity (face with name detected)
  const resetInactivityTimer = useCallback(() => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }
    inactivityTimerRef.current = setTimeout(() => {
      setShowScreensaver(true);
    }, INACTIVITY_TIMEOUT);
  }, []);

  // Watch for face activity
  useEffect(() => {
    const hasAnyFace = detectedFaces.length > 0;
    const hasMatchedEmployee = detectedFaces.some(f => f.employeeName);
    
    if (hasAnyFace) {
      // Any face detected - wake immediately
      if (showScreensaver) {
        setShowScreensaver(false);
        resetInactivityTimer();
      } else if (hasMatchedEmployee) {
        // Not in screensaver and matched employee - reset timer
        resetInactivityTimer();
      }
    }
  }, [detectedFaces, showScreensaver, resetInactivityTimer]);

  // Start the timer when detection starts
  useEffect(() => {
    if (status.isDetecting && !showScreensaver) {
      resetInactivityTimer();
    }
    return () => {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
    };
  }, [status.isDetecting, showScreensaver, resetInactivityTimer]);

  // Show toast on successful check-in
  useEffect(() => {
    if (matchResult && status.phase === "matched" && matchResult.employeeId !== lastMatchRef.current) {
      lastMatchRef.current = matchResult.employeeId;
      toast.success(`เช็คชื่อสำเร็จ!`, {
        description: detectedEmployee?.fullName,
        duration: 3000,
      });
    }
  }, [matchResult, status.phase, detectedEmployee]);

  useEffect(() => {
    if (status.phase === "detecting") {
      lastMatchRef.current = null;
    }
  }, [status.phase]);

  // Draw face overlay
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

    if (!status.isDetecting || detectedFaces.length === 0) return;

    const videoDim = getVideoDimensions();
    const scaleX = containerRect.width / videoDim.width;
    const scaleY = containerRect.height / videoDim.height;

    for (const face of detectedFaces) {
      if (!face.boundingBox) continue;

      const { x: origX, y: origY, width: origW, height: origH } = face.boundingBox;
      const x = origX * scaleX;
      const y = origY * scaleY;
      const w = origW * scaleX;
      const h = origH * scaleY;

      const { employeeName, matchScore } = face;

      let color = "rgba(255, 255, 255, 0.5)";
      if (employeeName) {
        if (matchScore && matchScore > 0.8) {
          color = "rgba(34, 197, 94, 0.8)";
        } else if (matchScore && matchScore > 0.7) {
          color = "rgba(59, 130, 246, 0.8)";
        } else {
          color = "rgba(234, 179, 8, 0.8)";
        }
      }

      const radius = 20;
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.shadowColor = color;
      ctx.shadowBlur = 20;

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

      if (employeeName) {
        const fontSize = 28;
        ctx.font = `bold ${fontSize}px Inter, system-ui, sans-serif`;
        const scoreText = matchScore ? ` ${Math.round(matchScore * 100)}%` : "";
        const labelText = employeeName + scoreText;
        const textMetrics = ctx.measureText(labelText);
        const padding = 16;
        const labelX = x + (w - textMetrics.width - padding * 2) / 2;
        const labelY = y - fontSize - padding * 2 - 10;

        ctx.fillStyle = color;
        const labelRadius = 12;
        const labelWidth = textMetrics.width + padding * 2;
        const labelHeight = fontSize + padding * 2;
        
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

        ctx.fillStyle = "#ffffff";
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
      // Use requestAnimationFrame for smooth 60fps overlay
      let animationId: number;
      const animate = () => {
        drawFaceOverlay();
        animationId = requestAnimationFrame(animate);
      };
      animationId = requestAnimationFrame(animate);
      return () => cancelAnimationFrame(animationId);
    }
  }, [status.isDetecting, drawFaceOverlay]);

  const getStatusMessage = () => {
    if (!status.modelsReady) return { text: "กำลังโหลดระบบ...", color: "text-yellow-400", hint: null };
    if (status.phase === "loading-employees") return { text: "กำลังโหลดข้อมูล...", color: "text-yellow-400", hint: null };
    if (status.phase === "camera-initializing") return { text: "กำลังเปิดกล้อง...", color: "text-yellow-400", hint: null };
    if (status.phase === "cooldown") return { text: "สแกนสำเร็จ!", color: "text-green-400", hint: null };
    if (status.phase === "matched") return { text: "ยินดีต้อนรับ!", color: "text-green-400", hint: null };
    if (error) return { text: error, color: "text-red-400", hint: null };
    
    if (status.isDetecting && detectedFaces.length > 0) {
      const hasMatch = detectedFaces.some(f => f.employeeName);
      
      if (hasMatch) {
        if (status.matchInCooldown) {
          return { text: "✅ เช็คอินแล้ว", color: "text-green-400", hint: "คุณได้เช็คอินแล้ววันนี้" };
        }
        if (status.livenessScore < 0.3) {
          return { text: "กำลังยืนยันตัวตน...", color: "text-blue-400", hint: "💡 ขยับหน้าเล็กน้อย หรือกระพริบตา" };
        }
        const matchProgress = status.consecutiveMatchCount;
        const required = ACCURACY_CONFIG.CONSECUTIVE_MATCHES_REQUIRED;
        if (matchProgress > 0 && matchProgress < required) {
          return { text: `กำลังยืนยัน... (${matchProgress}/${required})`, color: "text-blue-400", hint: "✨ อยู่นิ่งๆ อีกสักครู่..." };
        }
        return { text: "กำลังประมวลผล...", color: "text-blue-400", hint: "🔄 อยู่นิ่งๆ หน้ากล้อง" };
      }
      
      return { text: "ไม่พบข้อมูลใบหน้า", color: "text-yellow-400", hint: "กรุณาลงทะเบียนใบหน้าก่อน" };
    }
    
    if (status.isDetecting) return { text: "กรุณาหันหน้าเข้าหากล้อง", color: "text-white", hint: null };
    return { text: "พร้อมสแกน", color: "text-white", hint: null };
  };

  const statusMessage = getStatusMessage();

  // Tap to dismiss screensaver
  const dismissScreensaver = () => {
    setShowScreensaver(false);
    resetInactivityTimer();
  };

  return (
    <div className="fixed inset-0 bg-black overflow-hidden">
      {/* Full screen video - always visible */}
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

        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/60 pointer-events-none" />

        {/* Top bar */}
        <div className="absolute top-0 left-0 right-0 p-6 flex items-start justify-between">
          <div>
            <div className="text-white/90 text-6xl font-light tracking-tight">
              {currentTime.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
            </div>
            <div className="text-white/60 text-xl mt-1">
              {currentTime.toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
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

        {/* Center status */}
        {!showScreensaver && (
          <div className="absolute inset-0 flex items-end justify-center pb-32 pointer-events-none">
            <div className="text-center">
              <p className={cn("text-3xl font-medium transition-all duration-300", statusMessage.color)}>
                {statusMessage.text}
              </p>
              {statusMessage.hint && (
                <p className="mt-2 text-lg text-white/70 animate-pulse">{statusMessage.hint}</p>
              )}
              
              {status.isDetecting && detectedFaces.length > 0 && (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-center gap-3">
                    <span className="text-white/60 text-sm w-24 text-right">
                      {status.livenessScore >= 0.3 ? "✓ ตัวตน" : "ตรวจตัวตน"}
                    </span>
                    <div className="w-32 h-2 bg-white/20 rounded-full overflow-hidden">
                      <div 
                        className={cn("h-full rounded-full transition-all duration-300", status.livenessScore >= 0.3 ? "bg-green-400" : "bg-yellow-400")}
                        style={{ width: `${Math.min(status.livenessScore * 100 * 3, 100)}%` }}
                      />
                    </div>
                  </div>
                  
                  {status.livenessScore >= 0.3 && detectedFaces.some(f => f.employeeName) && (
                    <div className="flex items-center justify-center gap-3">
                      <span className="text-white/60 text-sm w-24 text-right">
                        {status.consecutiveMatchCount >= ACCURACY_CONFIG.CONSECUTIVE_MATCHES_REQUIRED ? "✓ ยืนยัน" : "การยืนยัน"}
                      </span>
                      <div className="w-32 h-2 bg-white/20 rounded-full overflow-hidden">
                        <div 
                          className={cn("h-full rounded-full transition-all duration-300", status.consecutiveMatchCount >= ACCURACY_CONFIG.CONSECUTIVE_MATCHES_REQUIRED ? "bg-green-400" : "bg-blue-400")}
                          style={{ width: `${(status.consecutiveMatchCount / ACCURACY_CONFIG.CONSECUTIVE_MATCHES_REQUIRED) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Success overlay */}
        {(status.phase === "matched" || status.phase === "cooldown") && detectedEmployee && (
          <div className="absolute inset-0 bg-green-500/20 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-300">
            <div className="text-center">
              <div className="relative inline-block mb-6">
                <div className="w-32 h-32 rounded-full bg-green-500 flex items-center justify-center animate-in zoom-in duration-300">
                  <svg className="w-16 h-16 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              </div>
              <h1 className="text-5xl font-bold text-white mb-2">{detectedEmployee.fullName}</h1>
              <p className="text-2xl text-green-300">{detectedEmployee.department} · {detectedEmployee.role}</p>
              {matchResult && (
                <p className="text-lg text-white/70 mt-4">ความแม่นยำ {Math.round(matchResult.score * 100)}%</p>
              )}
            </div>
          </div>
        )}

        {/* Loading state */}
        {(!status.modelsReady || status.phase === "loading-employees" || status.phase === "camera-initializing") && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center">
            <div className="text-center">
              <div className="w-20 h-20 border-4 border-white/20 border-t-white rounded-full animate-spin mx-auto mb-6" />
              <p className="text-white text-2xl font-medium">{statusMessage.text}</p>
            </div>
          </div>
        )}

        {/* SCREENSAVER OVERLAY */}
        {showScreensaver && (
          <div 
            className="absolute inset-0 z-50 bg-slate-950/95 flex flex-col items-center justify-center cursor-pointer"
            onClick={dismissScreensaver}
          >
            {/* Big clock */}
            <div className="text-white/80 text-9xl font-extralight tracking-tight mb-4">
              {currentTime.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
            </div>
            <div className="text-white/40 text-2xl font-light mb-16">
              {currentTime.toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long" })}
            </div>

            {/* Tap prompt */}
            <div className="text-white/30 text-xl animate-pulse">
              👆 แตะหน้าจอเพื่อเริ่มเช็คอิน
            </div>

            {/* Recent check-ins */}
            {checkInLogs.length > 0 && (
              <div className="absolute bottom-12 left-0 right-0">
                <p className="text-center text-white/20 text-sm mb-4">เช็คอินล่าสุด</p>
                <div className="flex justify-center gap-4">
                  {checkInLogs.slice(0, 5).map((log) => (
                    <div key={log.id} className="flex flex-col items-center">
                      <div className="w-12 h-12 rounded-full bg-slate-800 overflow-hidden ring-2 ring-white/10">
                        {log.snapshotUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={log.snapshotUrl} alt={log.employeeName} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-white/50">
                            {log.employeeName.slice(0, 1)}
                          </div>
                        )}
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
          <div className="text-white/30 text-sm">Powered by AI Face Recognition</div>
        </div>
      </div>
    </div>
  );
};
