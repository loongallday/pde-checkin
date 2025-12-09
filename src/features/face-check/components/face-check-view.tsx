"use client";

import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "@/components/ui/sonner";
import { AppShell } from "@/shared/components/app-shell";
import { InlineError } from "@/shared/components/feedback/inline-error";
import type { FaceMatchResult, Employee } from "@/entities/employee";
import type { EmployeeRepositoryKind } from "@/shared/repositories/employee-repository";
import type { FaceCheckPhase, CheckInLogEntry } from "../hooks/use-face-check-view-model";
import type { DetectedFace } from "@/shared/lib/face-embedding";
import { FaceCaptureSection, phaseLabel } from "./face-capture-section";

interface FaceCheckViewProps {
  employees: Employee[];
  detectedEmployee: Employee | null;
  repositoryKind: EmployeeRepositoryKind;
  status: {
    phase: FaceCheckPhase;
    isLoadingEmployees: boolean;
    isCameraSupported: boolean;
    isDetecting: boolean;
    modelsReady: boolean;
    livenessScore: number;
  };
  videoRef: RefObject<HTMLVideoElement | null>;
  matchResult: FaceMatchResult | null;
  snapshot: string | null;
  error: string | null;
  detectedFaces: DetectedFace[];
  checkInLogs: CheckInLogEntry[];
  getVideoDimensions: () => { width: number; height: number };
  actions: {
    initializeCamera: () => Promise<void | boolean>;
    startDetection: () => void;
    stopDetection: () => void;
    captureForEnrollment: () => Promise<boolean>;
    enrollFromLastCapture: (employeeId: string) => Promise<boolean>;
    stopCamera: () => void;
    resetSession: () => void;
  };
}

const repositoryLabel: Record<EmployeeRepositoryKind, string> = {
  supabase: "Supabase",
  memory: "ข้อมูลจำลองในหน่วยความจำ",
};

export const FaceCheckView = ({
  employees,
  detectedEmployee,
  repositoryKind,
  status,
  videoRef,
  matchResult,
  snapshot,
  error,
  detectedFaces,
  checkInLogs,
  getVideoDimensions,
  actions,
}: FaceCheckViewProps) => {
  const lastMatchRef = useRef<string | null>(null);

  // Show toast on successful check-in
  useEffect(() => {
    if (matchResult && status.phase === "matched" && matchResult.employeeId !== lastMatchRef.current) {
      lastMatchRef.current = matchResult.employeeId;
      
      toast.success(`เช็คชื่อสำเร็จ!`, {
        description: `${detectedEmployee?.fullName || "พนักงาน"} - ${Math.round(matchResult.score * 100)}% ตรงกัน`,
        duration: 4000,
      });
    }
  }, [matchResult, status.phase, detectedEmployee]);

  // Reset last match when going back to detecting
  useEffect(() => {
    if (status.phase === "detecting") {
      lastMatchRef.current = null;
    }
  }, [status.phase]);

  const enrolledCount = employees.filter((emp) => emp.embedding?.vector?.length).length;

  return (
    <AppShell
      title="ระบบเช็คชื่อด้วยใบหน้า"
      subtitle="เดินผ่านหน้ากล้องเพื่อเช็คชื่ออัตโนมัติ"
      rightSlot={
        <div className="flex items-center gap-2">
          {status.modelsReady && (
            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
              AI พร้อม
            </Badge>
          )}
          <Badge variant="outline" className="text-xs">
            {repositoryLabel[repositoryKind]}
          </Badge>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Success Card - Shows briefly after check-in */}
        {detectedEmployee && (status.phase === "matched" || status.phase === "cooldown") && (
          <Card className="border-green-500 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <Avatar className="h-20 w-20 ring-4 ring-green-500 ring-offset-2">
                    <AvatarImage src={detectedEmployee.avatarUrl} alt={detectedEmployee.fullName} />
                    <AvatarFallback className="text-2xl bg-green-100 text-green-700">
                      {detectedEmployee.fullName.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-green-500 flex items-center justify-center">
                    <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                </div>
                <div className="flex-1">
                  <p className="text-2xl font-bold text-green-700 dark:text-green-400">
                    {detectedEmployee.fullName}
                  </p>
                  <p className="text-sm text-green-600 dark:text-green-500">
                    {detectedEmployee.role} · {detectedEmployee.department}
                  </p>
                  <p className="text-sm font-medium text-green-600 dark:text-green-500 mt-1">
                    ✓ เช็คชื่อสำเร็จ {matchResult && `(${Math.round(matchResult.score * 100)}%)`}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <FaceCaptureSection
          videoRef={videoRef}
          phase={status.phase}
          isCameraSupported={status.isCameraSupported}
          isDetecting={status.isDetecting}
          detectedFaces={detectedFaces}
          getVideoDimensions={getVideoDimensions}
          livenessScore={status.livenessScore}
          onInitializeCamera={actions.initializeCamera}
          onStartDetection={actions.startDetection}
          onStopDetection={actions.stopDetection}
        />

        <InlineError message={error ?? ""} />

        {/* Check-in Logs */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span>📋</span>
              ประวัติเช็คชื่อวันนี้
            </CardTitle>
            <CardDescription>
              {checkInLogs.length > 0 ? `${checkInLogs.length} รายการ` : "ยังไม่มีการเช็คชื่อ"}
            </CardDescription>
          </CardHeader>
          {checkInLogs.length > 0 && (
            <CardContent className="p-0">
              <div className="max-h-[300px] overflow-y-auto">
                {checkInLogs.map((log, index) => (
                  <div
                    key={log.id}
                    className={`flex items-center gap-3 px-6 py-3 ${
                      index !== checkInLogs.length - 1 ? "border-b" : ""
                    }`}
                  >
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={log.avatarUrl} alt={log.employeeName} />
                      <AvatarFallback>{log.employeeName.slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{log.employeeName}</p>
                      <p className="text-xs text-muted-foreground">
                        {log.timestamp.toLocaleTimeString("th-TH", {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </p>
                    </div>
                    <Badge variant="secondary" className="text-xs">
                      {Math.round(log.similarity * 100)}%
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      </div>

      <div className="space-y-4">
        {/* Status Card */}
        <Card>
          <CardHeader>
            <CardTitle>สถานะระบบ</CardTitle>
            <CardDescription>ข้อมูลสถานะการประมวลผลแบบเรียลไทม์</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <div className="flex items-center justify-between">
              <span>สถานะ</span>
              <span className="font-medium text-foreground">{phaseLabel[status.phase]}</span>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span>AI Models</span>
              <span className={`font-medium ${status.modelsReady ? "text-green-600" : "text-yellow-600"}`}>
                {status.modelsReady ? "พร้อมใช้งาน" : "กำลังโหลด..."}
              </span>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span>การป้องกันรูปภาพ</span>
              <div className="flex items-center gap-2">
                <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-green-500 transition-all duration-300"
                    style={{ width: `${status.livenessScore * 100}%` }}
                  />
                </div>
                <span className="font-medium text-foreground text-xs">
                  {Math.round(status.livenessScore * 100)}%
                </span>
              </div>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span>พนักงานลงทะเบียนแล้ว</span>
              <span className="font-medium text-foreground">
                {enrolledCount} / {employees.length} คน
              </span>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span>เช็คชื่อวันนี้</span>
              <span className="font-medium text-foreground">
                {checkInLogs.length} ครั้ง
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Enrollment Section - Only show if no enrolled employees */}
        {enrolledCount === 0 && (
          <EnrollmentSection
            employees={employees}
            snapshot={snapshot}
            phase={status.phase}
            onCapture={actions.captureForEnrollment}
            onEnroll={actions.enrollFromLastCapture}
          />
        )}

        {enrolledCount === 0 && (
          <Alert variant="destructive">
            <AlertTitle>ไม่มีพนักงานที่ลงทะเบียนใบหน้า</AlertTitle>
            <AlertDescription>
              กรุณาลงทะเบียนใบหน้าพนักงานอย่างน้อย 1 คนก่อนใช้งานระบบ
            </AlertDescription>
          </Alert>
        )}
      </div>
    </AppShell>
  );
};

// Enrollment Section Component
interface EnrollmentSectionProps {
  employees: Employee[];
  snapshot: string | null;
  phase: FaceCheckPhase;
  onCapture: () => Promise<boolean>;
  onEnroll: (employeeId: string) => Promise<boolean>;
}

const EnrollmentSection = ({
  employees,
  snapshot,
  phase,
  onCapture,
  onEnroll,
}: EnrollmentSectionProps) => {
  const [selectedEmployeeForEnroll, setSelectedEmployeeForEnroll] = React.useState<string>("");

  const handleCapture = () => {
    void onCapture();
  };

  const handleEnroll = async () => {
    if (selectedEmployeeForEnroll) {
      const success = await onEnroll(selectedEmployeeForEnroll);
      if (success) {
        toast.success("ลงทะเบียนใบหน้าสำเร็จ!", {
          description: "สามารถใช้งานระบบเช็คชื่อได้แล้ว",
        });
        setSelectedEmployeeForEnroll("");
      }
    }
  };

  const enrolledCount = employees.filter((emp) => emp.embedding?.vector?.length).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">ลงทะเบียนใบหน้า</CardTitle>
        <CardDescription>
          ลงทะเบียนใบหน้าเพื่อใช้งานระบบ ({employees.length - enrolledCount} คนยังไม่ลงทะเบียน)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="employee-enroll">เลือกพนักงาน</Label>
          <Select value={selectedEmployeeForEnroll} onValueChange={setSelectedEmployeeForEnroll}>
            <SelectTrigger id="employee-enroll" className="w-full">
              <SelectValue placeholder="เลือกพนักงาน" />
            </SelectTrigger>
            <SelectContent>
              {employees.map((employee) => (
                <SelectItem key={employee.id} value={employee.id}>
                  {employee.fullName} {employee.embedding ? "✓" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-3">
          <Button 
            onClick={handleCapture} 
            variant="outline"
            disabled={!selectedEmployeeForEnroll || phase !== "camera-ready"}
          >
            ถ่ายภาพ
          </Button>
          <Button 
            onClick={() => void handleEnroll()} 
            disabled={!selectedEmployeeForEnroll || !snapshot}
          >
            บันทึกใบหน้า
          </Button>
        </div>
        {snapshot && selectedEmployeeForEnroll && (
          <div className="overflow-hidden rounded-xl border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={snapshot} alt="ภาพถ่ายสำหรับลงทะเบียน" className="h-48 w-full object-cover" />
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// Need to import React for useState in EnrollmentSection
import React from "react";
