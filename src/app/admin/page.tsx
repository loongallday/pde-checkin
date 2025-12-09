"use client";

import { useMemo, useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/components/ui/sonner";
import { useFaceCheckViewModel, MIN_REQUIRED_CAPTURES } from "@/features/face-check/hooks/use-face-check-view-model";
import { createEmployeeRepository, type CreateEmployeeInput } from "@/shared/repositories/employee-repository";
import { cn } from "@/lib/utils";
import type { FaceAngle, Employee } from "@/entities/employee";
import { PROGRESSIVE_LEARNING_CONFIG } from "@/entities/employee";

// Setup wizard steps
type SetupStep = "select" | "add-employee" | "capture" | "done";

// Angle guidance component
const AngleGuide = ({ angle, isActive, isComplete }: { angle: FaceAngle; isActive: boolean; isComplete: boolean }) => {
  const labels: Record<FaceAngle, string> = {
    "front": "หน้าตรง",
    "left": "หันซ้าย",
    "right": "หันขวา",
    "slight-left": "เฉียงซ้าย",
    "slight-right": "เฉียงขวา",
  };

  return (
    <div className={cn(
      "flex items-center gap-2 px-3 py-2 rounded-lg transition-all",
      isComplete && "bg-green-500/20 text-green-400",
      isActive && !isComplete && "bg-blue-500/20 text-blue-400 ring-2 ring-blue-400",
      !isActive && !isComplete && "bg-slate-700/50 text-slate-500"
    )}>
      {isComplete ? "✅" : isActive ? "📸" : "⭕"}
      <span className="text-sm font-medium">{labels[angle]}</span>
    </div>
  );
};

export default function AdminPage() {
  const repository = useMemo(() => createEmployeeRepository(), []);
  const viewModel = useFaceCheckViewModel({ repository, autoStart: false });
  
  // Wizard state
  const [step, setStep] = useState<SetupStep>("select");
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  
  // Quick add employee form
  const [employeeName, setEmployeeName] = useState("");
  const [employeeEmail, setEmployeeEmail] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  // Computed state
  const enrolledCount = viewModel.employees.filter(
    (emp) => emp.embeddings?.entries?.length || emp.embedding?.vector?.length
  ).length;

  const isCameraReady = viewModel.status.phase === "camera-ready" || 
                        viewModel.status.phase === "capturing" ||
                        viewModel.status.phase === "multi-capture";
  
  const isMultiCaptureMode = viewModel.status.phase === "multi-capture";
  const multiAngleProgress = viewModel.multiAngleState 
    ? (viewModel.multiAngleState.capturedEntries.length / viewModel.multiAngleState.targetAngles.length) * 100
    : 0;
  const currentTargetAngle = viewModel.multiAngleState?.targetAngles[viewModel.multiAngleState.currentAngleIndex];
  const isMultiCaptureComplete = Boolean(viewModel.multiAngleState && 
    viewModel.multiAngleState.capturedEntries.length >= MIN_REQUIRED_CAPTURES);

  // Auto-start camera when entering capture step
  useEffect(() => {
    if (step === "capture" && !isCameraReady && viewModel.status.modelsReady) {
      void viewModel.actions.initializeCamera();
    }
  }, [step, isCameraReady, viewModel.status.modelsReady, viewModel.actions]);

  // Quick add employee and go to capture
  const handleQuickAdd = async () => {
    if (!employeeName.trim()) {
      toast.error("กรุณากรอกชื่อพนักงาน");
      return;
    }

    setIsCreating(true);
    try {
      const email = employeeEmail.trim() || `${employeeName.toLowerCase().replace(/\s+/g, ".")}@company.com`;
      const created = await repository.addEmployee({
        fullName: employeeName.trim(),
        email,
        role: "Employee",
        department: "",
      });
      toast.success(`เพิ่ม ${created.fullName} สำเร็จ!`);
      setSelectedEmployee(created);
      setEmployeeName("");
      setEmployeeEmail("");
      setStep("capture");
    } catch (err) {
      toast.error("ไม่สามารถเพิ่มพนักงานได้", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsCreating(false);
    }
  };

  // Select existing employee and go to capture
  const handleSelectEmployee = (emp: Employee) => {
    setSelectedEmployee(emp);
    setStep("capture");
  };

  // Start multi-angle capture
  const handleStartCapture = () => {
    if (!selectedEmployee) return;
    viewModel.actions.startMultiAngleCapture();
  };

  // Capture one angle
  const handleCapture = async () => {
    setIsCapturing(true);
    try {
      const result = await viewModel.actions.captureMultiAngle();
      if (!result.success) {
        toast.error(result.message);
      }
    } finally {
      setIsCapturing(false);
    }
  };

  // Complete enrollment
  const handleComplete = async () => {
    if (!selectedEmployee) return;
    
    const success = await viewModel.actions.completeMultiAngleEnrollment(selectedEmployee.id);
    if (success) {
      toast.success(`ลงทะเบียนใบหน้า ${selectedEmployee.fullName} สำเร็จ!`);
      setStep("done");
    }
  };

  // Reset and start over
  const handleReset = () => {
    setStep("select");
    setSelectedEmployee(null);
    viewModel.actions.cancelMultiAngleCapture();
  };

  // Delete employee
  const handleDelete = async (emp: Employee) => {
    if (!confirm(`ต้องการลบ ${emp.fullName}?`)) return;
    
    try {
      await repository.deleteEmployee(emp.id);
      toast.success("ลบพนักงานสำเร็จ");
      if (selectedEmployee?.id === emp.id) {
        setSelectedEmployee(null);
        setStep("select");
      }
    } catch (err) {
      toast.error("ไม่สามารถลบได้");
    }
  };

  // Re-enroll face
  const handleReEnroll = async (emp: Employee) => {
    try {
      await repository.clearEmbeddings(emp.id);
      setSelectedEmployee(emp);
      setStep("capture");
      toast.info("พร้อมลงทะเบียนใบหน้าใหม่");
    } catch (err) {
      toast.error("เกิดข้อผิดพลาด");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-slate-900/80 backdrop-blur-lg border-b border-slate-700">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">ตั้งค่าระบบ</h1>
            <p className="text-sm text-slate-400">
              {enrolledCount}/{viewModel.employees.length} พนักงานลงทะเบียนแล้ว
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge className={cn(
              "text-xs",
              viewModel.repositoryKind === "supabase" 
                ? "bg-green-500/20 text-green-400" 
                : "bg-yellow-500/20 text-yellow-400"
            )}>
              {viewModel.repositoryKind === "supabase" ? "🟢 Online" : "🟡 Offline"}
            </Badge>
            <Link href="/history">
              <Button variant="outline" size="sm">
                📋 ประวัติ
              </Button>
            </Link>
            <Link href="/kiosk">
              <Button size="sm" className="bg-blue-600 hover:bg-blue-700">
                เปิด Kiosk
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Step: Select or Add Employee */}
        {step === "select" && (
          <>
            {/* Quick Add Card */}
            <Card className="bg-gradient-to-r from-blue-600/20 to-purple-600/20 border-blue-500/30">
              <CardHeader className="pb-3">
                <CardTitle className="text-white text-lg">➕ เพิ่มพนักงานใหม่</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-3">
                  <Input
                    placeholder="ชื่อพนักงาน *"
                    value={employeeName}
                    onChange={(e) => setEmployeeName(e.target.value)}
                    className="bg-slate-800/50 border-slate-600 text-white flex-1"
                    onKeyDown={(e) => e.key === "Enter" && handleQuickAdd()}
                  />
                  <Input
                    placeholder="อีเมล (ไม่บังคับ)"
                    value={employeeEmail}
                    onChange={(e) => setEmployeeEmail(e.target.value)}
                    className="bg-slate-800/50 border-slate-600 text-white flex-1"
                    onKeyDown={(e) => e.key === "Enter" && handleQuickAdd()}
                  />
                </div>
                <Button 
                  onClick={() => void handleQuickAdd()}
                  disabled={!employeeName.trim() || isCreating}
                  className="w-full bg-blue-600 hover:bg-blue-700"
                >
                  {isCreating ? "กำลังเพิ่ม..." : "เพิ่มและถ่ายภาพใบหน้า →"}
                </Button>
              </CardContent>
            </Card>

            {/* Employee List */}
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader className="pb-3">
                <CardTitle className="text-white text-lg">👥 พนักงานทั้งหมด</CardTitle>
                <CardDescription className="text-slate-400">
                  เลือกพนักงานเพื่อลงทะเบียนหรือแก้ไขใบหน้า
                </CardDescription>
              </CardHeader>
              <CardContent>
                {viewModel.employees.length === 0 ? (
                  <div className="text-center py-12 text-slate-500">
                    <p className="text-4xl mb-3">👆</p>
                    <p>ยังไม่มีพนักงาน</p>
                    <p className="text-sm">เพิ่มพนักงานคนแรกด้านบน</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {viewModel.employees.map((emp) => {
                      const embeddingCount = emp.embeddings?.entries?.length ?? (emp.embedding?.vector?.length ? 1 : 0);
                      const isEnrolled = embeddingCount > 0;
                      
                      return (
                        <div
                          key={emp.id}
                          className={cn(
                            "flex items-center justify-between p-4 rounded-xl border transition-all",
                            isEnrolled 
                              ? "bg-green-500/10 border-green-500/30" 
                              : "bg-slate-700/30 border-slate-600"
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <Avatar className="h-12 w-12 ring-2 ring-slate-600">
                              <AvatarImage src={emp.avatarUrl} />
                              <AvatarFallback className="bg-slate-700 text-white">
                                {emp.fullName.slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium text-white">{emp.fullName}</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                {isEnrolled ? (
                                  <Badge className="bg-green-500/20 text-green-400 text-xs">
                                    ✅ {embeddingCount}/{PROGRESSIVE_LEARNING_CONFIG.MAX_EMBEDDINGS} ภาพ
                                  </Badge>
                                ) : (
                                  <Badge className="bg-yellow-500/20 text-yellow-400 text-xs">
                                    ⚠️ ยังไม่ลงทะเบียน
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {isEnrolled ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => void handleReEnroll(emp)}
                                  className="text-slate-400 hover:text-white"
                                >
                                  🔄
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => void handleDelete(emp)}
                                  className="text-red-400 hover:text-red-300"
                                >
                                  🗑️
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button
                                  size="sm"
                                  onClick={() => handleSelectEmployee(emp)}
                                  className="bg-blue-600 hover:bg-blue-700"
                                >
                                  📸 ลงทะเบียน
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => void handleDelete(emp)}
                                  className="text-red-400 hover:text-red-300"
                                >
                                  🗑️
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {/* Step: Add Employee (alternative flow) */}
        {step === "add-employee" && (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white">เพิ่มพนักงานใหม่</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-slate-300">ชื่อ-นามสกุล *</Label>
                <Input
                  placeholder="ชื่อพนักงาน"
                  value={employeeName}
                  onChange={(e) => setEmployeeName(e.target.value)}
                  className="bg-slate-700 border-slate-600 text-white"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300">อีเมล</Label>
                <Input
                  placeholder="email@company.com"
                  value={employeeEmail}
                  onChange={(e) => setEmployeeEmail(e.target.value)}
                  className="bg-slate-700 border-slate-600 text-white"
                />
              </div>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep("select")} className="flex-1">
                  ← กลับ
                </Button>
                <Button 
                  onClick={() => void handleQuickAdd()}
                  disabled={!employeeName.trim() || isCreating}
                  className="flex-1 bg-blue-600 hover:bg-blue-700"
                >
                  {isCreating ? "กำลังบันทึก..." : "ถัดไป →"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step: Capture Face */}
        {step === "capture" && selectedEmployee && (
          <div className="space-y-4">
            {/* Selected employee header */}
            <Card className="bg-slate-800/50 border-slate-700">
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback className="bg-blue-600 text-white">
                        {selectedEmployee.fullName.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium text-white">{selectedEmployee.fullName}</p>
                      <p className="text-sm text-slate-400">กำลังลงทะเบียนใบหน้า</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={handleReset} className="text-slate-400">
                    ✕ ยกเลิก
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Camera view */}
            <Card className="bg-slate-800/50 border-slate-700 overflow-hidden">
              <div className="relative aspect-[4/3] bg-black">
                <video
                  ref={viewModel.videoRef}
                  className="h-full w-full object-cover"
                  playsInline
                  muted
                />
                
                {/* Loading overlay */}
                {!isCameraReady && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/80">
                    <div className="animate-spin w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full mb-4" />
                    <p className="text-slate-400">กำลังเปิดกล้อง...</p>
                  </div>
                )}

                {/* Multi-angle progress */}
                {isMultiCaptureMode && viewModel.multiAngleState && (
                  <div className="absolute top-4 left-4 right-4">
                    <div className="bg-black/70 backdrop-blur rounded-xl p-4">
                      <div className="flex items-center justify-between text-white mb-3">
                        <span className="font-medium">
                          {currentTargetAngle && viewModel.actions.getAngleGuidance(currentTargetAngle)}
                        </span>
                        <span className="text-sm text-slate-400">
                          {viewModel.multiAngleState.capturedEntries.length}/{viewModel.multiAngleState.targetAngles.length}
                        </span>
                      </div>
                      <Progress value={multiAngleProgress} className="h-2" />
                    </div>
                  </div>
                )}

                {/* Captured thumbnails */}
                {viewModel.multiAngleState && viewModel.multiAngleState.capturedSnapshots.length > 0 && (
                  <div className="absolute bottom-4 left-4 flex gap-2">
                    {viewModel.multiAngleState.capturedSnapshots.map((snap, i) => (
                      <div key={i} className="w-14 h-14 rounded-lg border-2 border-green-400 overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={snap.dataUrl} alt={snap.angle} className="w-full h-full object-cover" />
                      </div>
                    ))}
                  </div>
                )}

                {/* Quality indicator */}
                {viewModel.lastQuality && (
                  <div className={cn(
                    "absolute bottom-4 right-4 px-3 py-2 rounded-lg text-sm font-medium",
                    viewModel.lastQuality.isValid 
                      ? "bg-green-500/20 text-green-400" 
                      : "bg-red-500/20 text-red-400"
                  )}>
                    คุณภาพ {Math.round(viewModel.lastQuality.score * 100)}%
                  </div>
                )}
              </div>

              {/* Angle indicators */}
              {isMultiCaptureMode && viewModel.multiAngleState && (
                <div className="p-4 bg-slate-900/50 border-t border-slate-700">
                  <div className="flex justify-center gap-2 flex-wrap">
                    {viewModel.multiAngleState.targetAngles.map((angle, index) => (
                      <AngleGuide
                        key={angle}
                        angle={angle}
                        isActive={index === viewModel.multiAngleState!.currentAngleIndex}
                        isComplete={index < viewModel.multiAngleState!.capturedEntries.length}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Controls */}
              <div className="p-4 space-y-3">
                {!isMultiCaptureMode && isCameraReady && (
                  <Button 
                    onClick={handleStartCapture}
                    className="w-full bg-blue-600 hover:bg-blue-700 h-14 text-lg"
                  >
                    🎯 เริ่มถ่ายภาพ {MIN_REQUIRED_CAPTURES} มุม
                  </Button>
                )}

                {isMultiCaptureMode && !isMultiCaptureComplete && (
                  <Button 
                    onClick={() => void handleCapture()}
                    disabled={isCapturing}
                    className="w-full bg-blue-600 hover:bg-blue-700 h-14 text-lg"
                  >
                    {isCapturing ? "📸 กำลังถ่าย..." : `📸 ถ่าย ${currentTargetAngle?.replace("-", " ")}`}
                  </Button>
                )}

                {isMultiCaptureComplete && (
                  <Button 
                    onClick={() => void handleComplete()}
                    className="w-full bg-green-600 hover:bg-green-700 h-14 text-lg"
                  >
                    ✅ บันทึกใบหน้า
                  </Button>
                )}

                {viewModel.error && (
                  <p className="text-red-400 text-sm text-center">{viewModel.error}</p>
                )}
              </div>
            </Card>
          </div>
        )}

        {/* Step: Done */}
        {step === "done" && selectedEmployee && (
          <Card className="bg-gradient-to-r from-green-600/20 to-emerald-600/20 border-green-500/30">
            <CardContent className="py-12 text-center">
              <div className="text-6xl mb-4">✅</div>
              <h2 className="text-2xl font-bold text-white mb-2">ลงทะเบียนสำเร็จ!</h2>
              <p className="text-slate-300 mb-6">
                {selectedEmployee.fullName} พร้อมเช็คอินด้วยใบหน้าแล้ว
              </p>
              <div className="flex justify-center gap-3">
                <Button onClick={handleReset} variant="outline">
                  ← เพิ่มพนักงานอื่น
                </Button>
                <Link href="/kiosk">
                  <Button className="bg-blue-600 hover:bg-blue-700">
                    ไปหน้า Kiosk →
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
