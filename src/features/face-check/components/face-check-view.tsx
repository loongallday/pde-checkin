"use client";

import { useTransition } from "react";
import type { RefObject } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
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
import { FaceCaptureSection, phaseLabel } from "./face-capture-section";
import { FaceMatchResultCard } from "./face-match-result-card";

interface FaceCheckViewProps {
  employees: Employee[];
  selectedEmployeeId: string;
  setSelectedEmployeeId: (id: string) => void;
  repositoryKind: EmployeeRepositoryKind;
  status: {
    phase: FaceCheckPhase;
    isLoadingEmployees: boolean;
    isCameraSupported: boolean;
  };
  videoRef: RefObject<HTMLVideoElement | null>;
  matchResult: FaceMatchResult | null;
  snapshot: string | null;
  error: string | null;
  actions: {
    initializeCamera: () => Promise<void> | void;
    captureAndVerify: () => Promise<boolean>;
    stopCamera: () => void;
    enrollFromLastCapture: () => Promise<boolean>;
    resetSession: () => void;
  };
}

const repositoryLabel: Record<EmployeeRepositoryKind, string> = {
  supabase: "Supabase",
  memory: "ข้อมูลจำลองในหน่วยความจำ",
};

const getSelectedEmployee = (employees: Employee[], selectedId: string) =>
  employees.find((employee) => employee.id === selectedId) ?? null;

export const FaceCheckView = ({
  employees,
  selectedEmployeeId,
  setSelectedEmployeeId,
  repositoryKind,
  status,
  videoRef,
  matchResult,
  snapshot,
  error,
  actions,
}: FaceCheckViewProps) => {
  const [, startTransition] = useTransition();
  const selectedEmployee = getSelectedEmployee(employees, selectedEmployeeId);
  const repositoryDescription =
    repositoryKind === "supabase"
      ? "ข้อมูลแบบเรียลไทม์ผ่าน Supabase — เพิ่มข้อมูลประจำตัวของคุณใน NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY"
      : "ใช้ข้อมูลจำลองในเครื่องเพื่อทดสอบเวิร์กโฟลว์โดยไม่ต้องใช้ข้อมูลประจำตัว";

  const handleEmployeeChange = (value: string) => {
    startTransition(() => {
      setSelectedEmployeeId(value);
      actions.resetSession();
    });
  };

  const handleCapture = () => {
    void actions.captureAndVerify();
  };

  const handleEnroll = () => {
    void actions.enrollFromLastCapture();
  };

  return (
    <AppShell
      title="ระบบเช็คชื่อด้วยใบหน้า"
      subtitle="ถ่ายภาพพนักงาน เปรียบเทียบข้อมูลใบหน้า และบันทึกเหตุการณ์"
      rightSlot={
        <Badge variant="outline" className="text-xs">
          {repositoryLabel[repositoryKind]}
        </Badge>
      }
    >
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>เลือกพนักงาน</CardTitle>
            <CardDescription>เลือกผู้ที่ต้องการเช็คชื่อ</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="employee">พนักงาน</Label>
              <Select value={selectedEmployeeId} onValueChange={handleEmployeeChange}>
                <SelectTrigger id="employee" className="w-full">
                  <SelectValue placeholder="เลือกพนักงาน" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {employee.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedEmployee ? (
              <div className="flex items-center gap-4 rounded-lg border p-4">
                <Avatar>
                  <AvatarImage src={selectedEmployee.avatarUrl} alt={selectedEmployee.fullName} />
                  <AvatarFallback>{selectedEmployee.fullName.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">{selectedEmployee.fullName}</p>
                  <p className="text-xs text-muted-foreground">
                    {selectedEmployee.role}
                    {selectedEmployee.department ? ` · ${selectedEmployee.department}` : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    เช็คชื่อล่าสุด · {formatRelativeTime(selectedEmployee.lastCheckIn)}
                  </p>
                </div>
                <Badge variant={selectedEmployee.embedding ? "default" : "secondary"}>
                  {selectedEmployee.embedding ? "ลงทะเบียนแล้ว" : "ต้องลงทะเบียน"}
                </Badge>
              </div>
            ) : null}
            <InlineError message={error ?? ""} />
          </CardContent>
        </Card>

        <FaceCaptureSection
          videoRef={videoRef}
          phase={status.phase}
          isCameraSupported={status.isCameraSupported}
          onInitializeCamera={actions.initializeCamera}
          onCapture={handleCapture}
        />
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
          onEnroll={handleEnroll}
          hasSnapshot={Boolean(snapshot)}
        />

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
