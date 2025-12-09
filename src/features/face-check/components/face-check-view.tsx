"use client";

import { useState } from "react";
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
import { AppShell } from "@/shared/components/app-shell";
import { InlineError } from "@/shared/components/feedback/inline-error";
import { formatRelativeTime } from "@/shared/lib/datetime";
import type { FaceMatchResult, Employee } from "@/entities/employee";
import type { EmployeeRepositoryKind } from "@/shared/repositories/employee-repository";
import type { FaceCheckPhase } from "../hooks/use-face-check-view-model";
import type { DetectedFace } from "@/shared/lib/face-embedding";
import { FaceCaptureSection, phaseLabel } from "./face-capture-section";
import { FaceMatchResultCard } from "./face-match-result-card";
import { Input } from "@/components/ui/input";

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
  };
  videoRef: RefObject<HTMLVideoElement | null>;
  matchResult: FaceMatchResult | null;
  snapshot: string | null;
  error: string | null;
  detectedFaces: DetectedFace[];
  getVideoDimensions: () => { width: number; height: number };
  actions: {
    initializeCamera: () => Promise<void> | void;
    startDetection: () => void;
    stopDetection: () => void;
    confirmCheckIn: () => Promise<boolean>;
    captureForEnrollment: () => Promise<boolean>;
    enrollFromLastCapture: (employeeId: string) => Promise<boolean>;
    stopCamera: () => void;
    resetSession: () => void;
    addTestEmployee: (name: string) => Promise<Employee | null>;
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
  getVideoDimensions,
  actions,
}: FaceCheckViewProps) => {
  const [selectedEmployeeForEnroll, setSelectedEmployeeForEnroll] = useState<string>("");
  const [showEnrollment, setShowEnrollment] = useState(false);
  const [showDevTools, setShowDevTools] = useState(false);
  const [newEmployeeName, setNewEmployeeName] = useState("");
  const [isAddingEmployee, setIsAddingEmployee] = useState(false);

  const repositoryDescription =
    repositoryKind === "supabase"
      ? "ข้อมูลแบบเรียลไทม์ผ่าน Supabase — เพิ่มข้อมูลประจำตัวของคุณใน NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY"
      : "ใช้ข้อมูลจำลองในเครื่องเพื่อทดสอบเวิร์กโฟลว์โดยไม่ต้องใช้ข้อมูลประจำตัว";

  const enrolledCount = employees.filter((emp) => emp.embedding?.vector?.length).length;

  const handleConfirmCheckIn = () => {
    void actions.confirmCheckIn();
  };

  const handleEnroll = () => {
    if (selectedEmployeeForEnroll) {
      void actions.enrollFromLastCapture(selectedEmployeeForEnroll);
    }
  };

  const handleCaptureForEnrollment = () => {
    void actions.captureForEnrollment();
  };

  const handleAddTestEmployee = async () => {
    if (!newEmployeeName.trim()) return;
    setIsAddingEmployee(true);
    try {
      const result = await actions.addTestEmployee(newEmployeeName.trim());
      if (result) {
        setNewEmployeeName("");
      }
    } finally {
      setIsAddingEmployee(false);
    }
  };

  return (
    <AppShell
      title="ระบบเช็คชื่อด้วยใบหน้า"
      subtitle="เริ่มกล้องและกดตรวจจับเพื่อค้นหาพนักงานอัตโนมัติ"
      rightSlot={
        <Badge variant="outline" className="text-xs">
          {repositoryLabel[repositoryKind]}
        </Badge>
      }
    >
      <div className="space-y-4">
        {/* Detected Employee Card - Shows when a match is found */}
        {detectedEmployee && status.phase === "matched" ? (
          <Card className="border-green-500 bg-green-50 dark:bg-green-950/20">
            <CardHeader>
              <CardTitle className="text-green-700 dark:text-green-400">ตรวจพบพนักงาน</CardTitle>
              <CardDescription>ระบบตรวจพบพนักงานที่ตรงกันกับใบหน้าในกล้อง</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4 rounded-lg border border-green-200 bg-white p-4 dark:border-green-800 dark:bg-background">
                <Avatar className="h-16 w-16">
                  <AvatarImage src={detectedEmployee.avatarUrl} alt={detectedEmployee.fullName} />
                  <AvatarFallback className="text-lg">{detectedEmployee.fullName.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <p className="text-lg font-semibold text-foreground">{detectedEmployee.fullName}</p>
                  <p className="text-sm text-muted-foreground">
                    {detectedEmployee.role}
                    {detectedEmployee.department ? ` · ${detectedEmployee.department}` : null}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    เช็คชื่อล่าสุด · {formatRelativeTime(detectedEmployee.lastCheckIn)}
                  </p>
                </div>
                {matchResult && (
                  <Badge variant="default" className="bg-green-600">
                    {Math.round(matchResult.score * 100)}% ตรงกัน
                  </Badge>
                )}
              </div>
              <div className="flex gap-3">
                <Button onClick={handleConfirmCheckIn} className="flex-1 bg-green-600 hover:bg-green-700">
                  ยืนยันเช็คชื่อ
                </Button>
                <Button onClick={actions.resetSession} variant="outline" className="flex-1">
                  ยกเลิก
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <FaceCaptureSection
          videoRef={videoRef}
          phase={status.phase}
          isCameraSupported={status.isCameraSupported}
          isDetecting={status.isDetecting}
          detectedFaces={detectedFaces}
          getVideoDimensions={getVideoDimensions}
          onInitializeCamera={actions.initializeCamera}
          onStartDetection={actions.startDetection}
          onStopDetection={actions.stopDetection}
        />

        <InlineError message={error ?? ""} />

        {/* Enrollment Section - Collapsible */}
        <Card>
          <CardHeader 
            className="cursor-pointer" 
            onClick={() => setShowEnrollment(!showEnrollment)}
          >
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">ลงทะเบียนใบหน้าใหม่</CardTitle>
                <CardDescription>
                  สำหรับพนักงานที่ยังไม่มีข้อมูลใบหน้า ({employees.length - enrolledCount} คนยังไม่ลงทะเบียน)
                </CardDescription>
              </div>
              <Badge variant="secondary">
                {showEnrollment ? "ซ่อน" : "แสดง"}
              </Badge>
            </div>
          </CardHeader>
          {showEnrollment && (
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="employee-enroll">เลือกพนักงานที่ต้องการลงทะเบียน</Label>
                <Select value={selectedEmployeeForEnroll} onValueChange={setSelectedEmployeeForEnroll}>
                  <SelectTrigger id="employee-enroll" className="w-full">
                    <SelectValue placeholder="เลือกพนักงาน" />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((employee) => (
                      <SelectItem key={employee.id} value={employee.id}>
                        {employee.fullName} {employee.embedding ? "(ลงทะเบียนแล้ว)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-3">
                <Button 
                  onClick={handleCaptureForEnrollment} 
                  variant="outline"
                  disabled={!selectedEmployeeForEnroll || status.phase !== "camera-ready"}
                >
                  ถ่ายภาพ
                </Button>
                <Button 
                  onClick={handleEnroll} 
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
          )}
        </Card>

        {/* Dev Tools Section - For testing */}
        <Card className="border-dashed border-amber-500/50">
          <CardHeader 
            className="cursor-pointer" 
            onClick={() => setShowDevTools(!showDevTools)}
          >
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <span className="text-amber-500">🛠️</span>
                  เครื่องมือพัฒนา (Dev Tools)
                </CardTitle>
                <CardDescription>
                  เพิ่มพนักงานทดสอบพร้อมข้อมูลใบหน้าจากกล้อง
                </CardDescription>
              </div>
              <Badge variant="outline" className="border-amber-500/50 text-amber-600">
                {showDevTools ? "ซ่อน" : "แสดง"}
              </Badge>
            </div>
          </CardHeader>
          {showDevTools && (
            <CardContent className="space-y-4">
              <Alert className="border-amber-500/30 bg-amber-50 dark:bg-amber-950/20">
                <AlertTitle className="text-amber-700 dark:text-amber-400">สำหรับการทดสอบเท่านั้น</AlertTitle>
                <AlertDescription className="text-amber-600 dark:text-amber-500">
                  ฟีเจอร์นี้จะเพิ่มพนักงานใหม่พร้อมลงทะเบียนใบหน้าจากกล้องทันที เหมาะสำหรับทดสอบระบบ
                </AlertDescription>
              </Alert>
              <div className="space-y-2">
                <Label htmlFor="new-employee-name">ชื่อพนักงานทดสอบ</Label>
                <div className="flex gap-3">
                  <Input
                    id="new-employee-name"
                    placeholder="เช่น สมชาย ใจดี"
                    value={newEmployeeName}
                    onChange={(e) => setNewEmployeeName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        void handleAddTestEmployee();
                      }
                    }}
                  />
                  <Button 
                    onClick={() => void handleAddTestEmployee()}
                    disabled={!newEmployeeName.trim() || isAddingEmployee || status.phase !== "camera-ready"}
                    className="bg-amber-500 hover:bg-amber-600 text-white"
                  >
                    {isAddingEmployee ? "กำลังเพิ่ม..." : "เพิ่ม + ลงทะเบียนใบหน้า"}
                  </Button>
                </div>
              </div>
              {snapshot && newEmployeeName && (
                <div className="overflow-hidden rounded-xl border border-amber-500/30">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={snapshot} alt="ภาพถ่ายสำหรับทดสอบ" className="h-48 w-full object-cover" />
                </div>
              )}
            </CardContent>
          )}
        </Card>
      </div>

      <div className="space-y-4">
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
              <span>ข้อมูลพนักงาน</span>
              <span className="font-medium text-foreground">
                {status.isLoadingEmployees ? "กำลังโหลด" : `${employees.length} คน`}
              </span>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span>ลงทะเบียนใบหน้าแล้ว</span>
              <span className="font-medium text-foreground">
                {enrolledCount} / {employees.length} คน
              </span>
            </div>
            <Separator />
            <div className="space-y-1">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">แหล่งข้อมูล</span>
              <p className="text-sm text-foreground">{repositoryLabel[repositoryKind]}</p>
              <p className="text-xs text-muted-foreground">{repositoryDescription}</p>
            </div>
          </CardContent>
        </Card>

        <FaceMatchResultCard
          result={matchResult}
          onReset={actions.resetSession}
          hasSnapshot={Boolean(snapshot)}
        />

        {enrolledCount === 0 && (
          <Alert variant="destructive">
            <AlertTitle>ไม่มีพนักงานที่ลงทะเบียนใบหน้า</AlertTitle>
            <AlertDescription>
              กรุณาลงทะเบียนใบหน้าพนักงานอย่างน้อย 1 คนก่อนใช้งานระบบตรวจจับอัตโนมัติ
            </AlertDescription>
          </Alert>
        )}

        <Alert>
          <AlertTitle>ต้องใช้ข้อมูลประจำตัว Supabase</AlertTitle>
          <AlertDescription>
            ตั้งค่า NEXT_PUBLIC_SUPABASE_URL และ NEXT_PUBLIC_SUPABASE_ANON_KEY แล้วรีสตาร์ทเซิร์ฟเวอร์เพื่อบันทึกการเช็คชื่อแบบออนไลน์
          </AlertDescription>
        </Alert>
      </div>
    </AppShell>
  );
};
