"use client";

import { RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { FaceCheckPhase } from "../hooks/use-face-check-view-model";

interface FaceCaptureSectionProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  phase: FaceCheckPhase;
  isCameraSupported: boolean;
  isDetecting: boolean;
  onInitializeCamera: () => Promise<void> | void;
  onStartDetection: () => void;
  onStopDetection: () => void;
}

export const phaseLabel: Record<FaceCheckPhase, string> = {
  idle: "พร้อม",
  "loading-employees": "กำลังโหลดข้อมูลพนักงาน",
  "camera-initializing": "กำลังเตรียมกล้อง",
  "camera-ready": "กล้องพร้อมใช้งาน",
  detecting: "กำลังตรวจจับใบหน้า",
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
  onInitializeCamera,
  onStartDetection,
  onStopDetection,
}: FaceCaptureSectionProps) => {
  const isCameraReady = phase === "camera-ready" || phase === "matched" || phase === "mismatch" || phase === "detecting";
  const isProcessing = phase === "camera-initializing" || phase === "capturing" || phase === "verifying";

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
            <div className="relative aspect-[3/2] w-full overflow-hidden rounded-xl border bg-muted">
              <video
                ref={videoRef}
                className={cn("h-full w-full object-cover", !isCameraReady && "opacity-80 grayscale")}
                playsInline
                muted
              />
              {!isCameraReady ? (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                  กล้องยังไม่พร้อมใช้งาน
                </div>
              ) : null}
              {isDetecting ? (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="rounded-full border-4 border-primary/50 p-8 animate-pulse">
                    <div className="h-32 w-32 rounded-full border-4 border-dashed border-primary animate-spin" style={{ animationDuration: "3s" }} />
                  </div>
                </div>
              ) : null}
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
