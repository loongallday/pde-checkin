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
  onInitializeCamera: () => Promise<void> | void;
  onCapture: () => Promise<boolean> | void;
}

export const phaseLabel: Record<FaceCheckPhase, string> = {
  idle: "พร้อม",
  "loading-employees": "กำลังโหลดข้อมูลพนักงาน",
  "camera-initializing": "กำลังเตรียมกล้อง",
  "camera-ready": "กล้องพร้อมใช้งาน",
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
  onInitializeCamera,
  onCapture,
}: FaceCaptureSectionProps) => {
  const isCameraReady = phase === "camera-ready" || phase === "matched" || phase === "mismatch";
  const isProcessing = phase === "camera-initializing" || phase === "capturing" || phase === "verifying";

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>กล้องถ่ายทอดสด</CardTitle>
          <CardDescription>เริ่มการถ่ายทอดและถ่ายภาพใบหน้า</CardDescription>
        </div>
        <Badge variant={phase === "matched" ? "default" : phase === "mismatch" ? "destructive" : "secondary"}>
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
            </div>
            <div className="flex flex-wrap gap-3">
              <Button onClick={onInitializeCamera} disabled={isProcessing} variant="outline">
                {isCameraReady ? "เริ่มกล้องใหม่" : "เริ่มกล้อง"}
              </Button>
              <Button onClick={onCapture} disabled={!isCameraReady || isProcessing}>
                {isProcessing ? "กำลังประมวลผล" : "ถ่ายภาพและตรวจสอบ"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
