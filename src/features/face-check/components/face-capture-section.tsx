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

const phaseLabel: Record<FaceCheckPhase, string> = {
  idle: "Idle",
  "loading-employees": "Loading employees",
  "camera-initializing": "Preparing camera",
  "camera-ready": "Camera ready",
  capturing: "Capturing frame",
  verifying: "Verifying face",
  matched: "Match found",
  mismatch: "Mismatch detected",
  error: "Error",
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
          <CardTitle>Live Camera</CardTitle>
          <CardDescription>Start the feed and capture a face snapshot.</CardDescription>
        </div>
        <Badge variant={phase === "matched" ? "default" : phase === "mismatch" ? "destructive" : "secondary"}>
          {phaseLabel[phase]}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isCameraSupported ? (
          <Alert variant="destructive">
            <AlertTitle>Camera unavailable</AlertTitle>
            <AlertDescription>
              This device does not expose a camera stream. Connect a webcam or use a mobile device to run the
              check-in.
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
                  Camera is not running yet
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-3">
              <Button onClick={onInitializeCamera} disabled={isProcessing} variant="outline">
                {isCameraReady ? "Restart camera" : "Start camera"}
              </Button>
              <Button onClick={onCapture} disabled={!isCameraReady || isProcessing}>
                {isProcessing ? "Processing" : "Capture & verify"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
