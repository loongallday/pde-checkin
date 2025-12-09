"use client";

import { useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/sonner";
import { useFaceCheckViewModel, REQUIRED_ANGLES, MIN_REQUIRED_CAPTURES } from "@/features/face-check/hooks/use-face-check-view-model";
import { createEmployeeRepository, type CreateEmployeeInput } from "@/shared/repositories/employee-repository";
import { cn } from "@/lib/utils";
import type { FaceAngle } from "@/entities/employee";
import { PROGRESSIVE_LEARNING_CONFIG } from "@/entities/employee";

// Angle icons for visual guidance
const AngleIcon = ({ angle, active, completed }: { angle: FaceAngle; active: boolean; completed: boolean }) => {
  const getIcon = () => {
    switch (angle) {
      case "front": return "😐";
      case "left": return "😏";
      case "right": return "🙃";
      case "slight-left": return "🤨";
      case "slight-right": return "🧐";
      default: return "😐";
    }
  };

  return (
    <div className={cn(
      "flex flex-col items-center gap-1 p-2 rounded-lg transition-all",
      completed && "bg-green-500/20 text-green-400",
      active && !completed && "bg-blue-500/20 text-blue-400 ring-2 ring-blue-500",
      !active && !completed && "bg-slate-700/50 text-slate-500"
    )}>
      <span className="text-2xl">{getIcon()}</span>
      <span className="text-xs capitalize">{angle.replace("-", " ")}</span>
      {completed && <span className="text-xs">✓</span>}
    </div>
  );
};

export default function AdminPage() {
  const repository = useMemo(() => createEmployeeRepository(), []);
  const viewModel = useFaceCheckViewModel({ repository, autoStart: false });
  
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [isCapturing, setIsCapturing] = useState(false);
  const [enrollmentMode, setEnrollmentMode] = useState<"single" | "multi">("multi");
  
  // New employee form state
  const [showNewEmployeeForm, setShowNewEmployeeForm] = useState(false);
  const [newEmployee, setNewEmployee] = useState<CreateEmployeeInput>({
    fullName: "",
    email: "",
    role: "Employee",
    department: "",
  });
  const [isCreatingEmployee, setIsCreatingEmployee] = useState(false);

  // Count enrolled employees (both single and multi-embeddings)
  const enrolledCount = viewModel.employees.filter(
    (emp) => emp.embeddings?.entries?.length || emp.embedding?.vector?.length
  ).length;

  const selectedEmployee = viewModel.employees.find(emp => emp.id === selectedEmployeeId);

  const handleStartCamera = async () => {
    await viewModel.actions.initializeCamera();
  };

  // Create new employee
  const handleCreateEmployee = async () => {
    if (!newEmployee.fullName.trim() || !newEmployee.email.trim()) {
      toast.error("กรุณากรอกชื่อและอีเมล");
      return;
    }

    setIsCreatingEmployee(true);
    try {
      const created = await repository.addEmployee(newEmployee);
      toast.success("เพิ่มพนักงานสำเร็จ!", {
        description: created.fullName,
      });
      setNewEmployee({ fullName: "", email: "", role: "Employee", department: "" });
      setShowNewEmployeeForm(false);
      setSelectedEmployeeId(created.id);
      // Real-time subscription will auto-update the employee list
    } catch (err) {
      toast.error("ไม่สามารถเพิ่มพนักงานได้", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsCreatingEmployee(false);
    }
  };

  // Clear face embeddings for re-enrollment
  const handleClearFace = useCallback(async () => {
    if (!selectedEmployeeId) {
      toast.error("กรุณาเลือกพนักงาน");
      return;
    }

    try {
      await repository.clearEmbeddings(selectedEmployeeId);
      toast.success("ลบข้อมูลใบหน้าเรียบร้อย", {
        description: "พร้อมลงทะเบียนใหม่",
      });
      // Real-time subscription will auto-update the employee list
    } catch (err) {
      toast.error("ไม่สามารถลบข้อมูลได้", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }, [selectedEmployeeId, repository]);

  // Delete employee
  const handleDeleteEmployee = useCallback(async () => {
    if (!selectedEmployeeId) {
      toast.error("กรุณาเลือกพนักงาน");
      return;
    }

    if (!confirm("ต้องการลบพนักงานนี้หรือไม่?")) return;

    try {
      await repository.deleteEmployee(selectedEmployeeId);
      toast.success("ลบพนักงานเรียบร้อย");
      setSelectedEmployeeId("");
      // Real-time subscription will auto-update the employee list
    } catch (err) {
      toast.error("ไม่สามารถลบพนักงานได้", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }, [selectedEmployeeId, repository]);

  // Single image capture (legacy mode)
  const handleSingleCapture = async () => {
    if (!selectedEmployeeId) {
      toast.error("กรุณาเลือกพนักงาน");
      return;
    }

    setIsCapturing(true);
    try {
      const success = await viewModel.actions.captureForEnrollment();
      if (success) {
        toast.success("ถ่ายภาพสำเร็จ!");
      } else if (viewModel.error) {
        toast.error(viewModel.error);
      }
    } finally {
      setIsCapturing(false);
    }
  };

  // Start multi-angle capture
  const handleStartMultiCapture = () => {
    if (!selectedEmployeeId) {
      toast.error("กรุณาเลือกพนักงานก่อน");
      return;
    }
    viewModel.actions.startMultiAngleCapture();
  };

  // Capture for multi-angle
  const handleMultiCapture = async () => {
    setIsCapturing(true);
    try {
      const result = await viewModel.actions.captureMultiAngle();
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    } finally {
      setIsCapturing(false);
    }
  };

  // Complete multi-angle enrollment
  const handleCompleteMultiEnrollment = async () => {
    if (!selectedEmployeeId) {
      toast.error("กรุณาเลือกพนักงาน");
      return;
    }

    const success = await viewModel.actions.completeMultiAngleEnrollment(selectedEmployeeId);
    if (success) {
      toast.success("ลงทะเบียนใบหน้าหลายมุมสำเร็จ!", {
        description: `บันทึก ${viewModel.multiAngleState?.capturedEntries.length ?? 0} มุมเรียบร้อย`,
      });
      setSelectedEmployeeId("");
    }
  };

  // Single image enrollment (legacy)
  const handleSingleEnroll = async () => {
    if (!selectedEmployeeId) {
      toast.error("กรุณาเลือกพนักงาน");
      return;
    }

    const success = await viewModel.actions.enrollFromLastCapture(selectedEmployeeId);
    if (success) {
      toast.success("ลงทะเบียนใบหน้าสำเร็จ!");
      setSelectedEmployeeId("");
    }
  };

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

  const hasExistingFace = selectedEmployee?.embeddings?.entries?.length || selectedEmployee?.embedding?.vector?.length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white">Admin Panel</h1>
            <p className="text-slate-400 mt-1">จัดการพนักงานและลงทะเบียนใบหน้า</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Connection status */}
            <div className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm",
              viewModel.repositoryKind === "supabase" 
                ? "bg-green-500/20 text-green-400" 
                : "bg-yellow-500/20 text-yellow-400"
            )}>
              <div className={cn(
                "w-2 h-2 rounded-full",
                viewModel.repositoryKind === "supabase" ? "bg-green-400" : "bg-yellow-400"
              )} />
              {viewModel.repositoryKind === "supabase" ? "Supabase" : "Local Memory"}
            </div>
            <Link href="/kiosk">
              <Button variant="outline" className="gap-2">
                <span>📺</span>
                เปิด Kiosk Mode
              </Button>
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Camera Section */}
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                กล้องลงทะเบียน
                {isMultiCaptureMode && (
                  <Badge className="bg-blue-500/20 text-blue-400">โหมดหลายมุม</Badge>
                )}
              </CardTitle>
              <CardDescription className="text-slate-400">
                {isMultiCaptureMode && currentTargetAngle
                  ? viewModel.actions.getAngleGuidance(currentTargetAngle)
                  : "ถ่ายภาพใบหน้าเพื่อลงทะเบียนพนักงาน"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative aspect-video w-full overflow-hidden rounded-xl border-2 border-slate-600 bg-black">
                <video
                  ref={viewModel.videoRef}
                  className={cn("h-full w-full object-cover", !isCameraReady && "opacity-30")}
                  playsInline
                  muted
                />
                {!isCameraReady && (
                  <div className="absolute inset-0 flex items-center justify-center text-slate-500">
                    กล้องยังไม่เริ่ม
                  </div>
                )}
                
                {/* Multi-angle progress overlay */}
                {isMultiCaptureMode && (
                  <div className="absolute top-3 left-3 right-3">
                    <div className="bg-black/60 backdrop-blur-sm rounded-lg p-3">
                      <div className="flex items-center justify-between text-sm text-white mb-2">
                        <span>ความคืบหน้า</span>
                        <span>{viewModel.multiAngleState?.capturedEntries.length}/{viewModel.multiAngleState?.targetAngles.length} มุม</span>
                      </div>
                      <Progress value={multiAngleProgress} className="h-2" />
                    </div>
                  </div>
                )}

                {/* Quality indicator */}
                {viewModel.lastQuality && (
                  <div className={cn(
                    "absolute bottom-3 left-3 px-3 py-1.5 rounded-lg text-sm",
                    viewModel.lastQuality.isValid 
                      ? "bg-green-500/20 text-green-400" 
                      : "bg-red-500/20 text-red-400"
                  )}>
                    คุณภาพ: {Math.round(viewModel.lastQuality.score * 100)}%
                  </div>
                )}

                {/* Captured snapshots thumbnails */}
                {viewModel.multiAngleState && viewModel.multiAngleState.capturedSnapshots.length > 0 && (
                  <div className="absolute bottom-3 right-3 flex gap-1">
                    {viewModel.multiAngleState.capturedSnapshots.slice(-3).map((snap, i) => (
                      <div key={i} className="w-12 h-12 rounded-lg border-2 border-white overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={snap.dataUrl} alt={snap.angle} className="w-full h-full object-cover" />
                      </div>
                    ))}
                  </div>
                )}

                {/* Single capture snapshot */}
                {!isMultiCaptureMode && viewModel.snapshot && (
                  <div className="absolute bottom-3 right-3 w-24 h-24 rounded-lg border-2 border-white overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={viewModel.snapshot} alt="Captured" className="w-full h-full object-cover" />
                  </div>
                )}
              </div>

              {/* Multi-angle indicators */}
              {isMultiCaptureMode && viewModel.multiAngleState && (
                <div className="flex justify-center gap-2">
                  {viewModel.multiAngleState.targetAngles.map((angle, index) => (
                    <AngleIcon
                      key={angle}
                      angle={angle}
                      active={index === viewModel.multiAngleState!.currentAngleIndex}
                      completed={index < viewModel.multiAngleState!.capturedEntries.length}
                    />
                  ))}
                </div>
              )}

              {/* Camera controls */}
              <div className="flex gap-3">
                {!isCameraReady && (
                  <Button 
                    onClick={() => void handleStartCamera()} 
                    variant="outline" 
                    className="flex-1"
                  >
                    เริ่มกล้อง
                  </Button>
                )}
                
                {isCameraReady && !isMultiCaptureMode && (
                  <>
                    {enrollmentMode === "single" ? (
                      <Button 
                        onClick={() => void handleSingleCapture()} 
                        className="flex-1"
                        disabled={isCapturing || !selectedEmployeeId}
                      >
                        {isCapturing ? "กำลังถ่าย..." : "📸 ถ่ายภาพ"}
                      </Button>
                    ) : (
                      <Button 
                        onClick={handleStartMultiCapture} 
                        className="flex-1 bg-blue-600 hover:bg-blue-700"
                        disabled={!selectedEmployeeId}
                      >
                        🎯 เริ่มถ่ายหลายมุม
                      </Button>
                    )}
                  </>
                )}

                {isMultiCaptureMode && (
                  <>
                    <Button 
                      onClick={() => void handleMultiCapture()} 
                      className="flex-1 bg-blue-600 hover:bg-blue-700"
                      disabled={isCapturing || isMultiCaptureComplete}
                    >
                      {isCapturing ? "กำลังถ่าย..." : `📸 ถ่ายมุม ${currentTargetAngle?.replace("-", " ")}`}
                    </Button>
                    <Button 
                      onClick={viewModel.actions.cancelMultiAngleCapture} 
                      variant="outline"
                    >
                      ยกเลิก
                    </Button>
                  </>
                )}
              </div>

              {viewModel.error && (
                <p className="text-red-400 text-sm">{viewModel.error}</p>
              )}
            </CardContent>
          </Card>

          {/* Enrollment Form */}
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white">จัดการพนักงาน</CardTitle>
              <CardDescription className="text-slate-400">
                เลือกพนักงานหรือเพิ่มใหม่ แล้วลงทะเบียนใบหน้า
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Enrollment mode selector */}
              <div className="flex gap-2">
                <Button
                  variant={enrollmentMode === "multi" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setEnrollmentMode("multi")}
                  className="flex-1"
                >
                  🎯 หลายมุม (แนะนำ)
                </Button>
                <Button
                  variant={enrollmentMode === "single" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setEnrollmentMode("single")}
                  className="flex-1"
                >
                  📸 มุมเดียว
                </Button>
              </div>

              {enrollmentMode === "multi" && (
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 text-sm text-blue-300">
                  <p className="font-medium mb-1">โหมดถ่ายหลายมุม</p>
                  <p className="text-blue-400/80">
                    ถ่ายภาพ {MIN_REQUIRED_CAPTURES} มุม เพื่อเพิ่มความแม่นยำในการจดจำใบหน้า
                  </p>
                </div>
              )}

              <Separator className="bg-slate-700" />

              {/* Employee selection */}
              <div className="space-y-2">
                <Label className="text-slate-300">เลือกพนักงาน</Label>
                <Select 
                  value={selectedEmployeeId} 
                  onValueChange={setSelectedEmployeeId}
                  disabled={isMultiCaptureMode}
                >
                  <SelectTrigger className="bg-slate-700 border-slate-600 text-white">
                    <SelectValue placeholder="เลือกพนักงาน..." />
                  </SelectTrigger>
                  <SelectContent>
                    {viewModel.employees.map((emp) => {
                      const hasMulti = emp.embeddings?.entries?.length;
                      const hasSingle = emp.embedding?.vector?.length;
                      return (
                        <SelectItem key={emp.id} value={emp.id}>
                          <div className="flex items-center gap-2">
                            <span>{emp.fullName}</span>
                            {hasMulti && (
                              <Badge variant="secondary" className="text-xs bg-green-500/20 text-green-400">
                                {emp.embeddings?.entries?.length} มุม
                              </Badge>
                            )}
                            {!hasMulti && hasSingle && (
                              <Badge variant="secondary" className="text-xs">1 มุม</Badge>
                            )}
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              {/* Selected employee actions */}
              {selectedEmployee && (
                <div className="bg-slate-700/50 rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-12 w-12">
                      <AvatarImage src={selectedEmployee.avatarUrl} alt={selectedEmployee.fullName} />
                      <AvatarFallback>{selectedEmployee.fullName.slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium text-white">{selectedEmployee.fullName}</p>
                      <p className="text-sm text-slate-400">{selectedEmployee.email}</p>
                    </div>
                  </div>
                  
                  {hasExistingFace && (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleClearFace()}
                        className="flex-1 text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/10"
                      >
                        🔄 ลงทะเบียนใหม่
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleDeleteEmployee()}
                        className="text-red-400 border-red-500/30 hover:bg-red-500/10"
                      >
                        🗑️ ลบ
                      </Button>
                    </div>
                  )}
                </div>
              )}

              <Separator className="bg-slate-700" />

              {/* New employee form toggle */}
              <Button
                variant="outline"
                onClick={() => setShowNewEmployeeForm(!showNewEmployeeForm)}
                className="w-full"
              >
                {showNewEmployeeForm ? "ยกเลิก" : "➕ เพิ่มพนักงานใหม่"}
              </Button>

              {/* New employee form */}
              {showNewEmployeeForm && (
                <div className="space-y-3 bg-slate-700/30 rounded-lg p-4">
                  <div className="space-y-2">
                    <Label className="text-slate-300">ชื่อ-นามสกุล *</Label>
                    <Input
                      placeholder="ชื่อพนักงาน..."
                      value={newEmployee.fullName}
                      onChange={(e) => setNewEmployee({ ...newEmployee, fullName: e.target.value })}
                      className="bg-slate-700 border-slate-600 text-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-slate-300">อีเมล *</Label>
                    <Input
                      type="email"
                      placeholder="email@example.com"
                      value={newEmployee.email}
                      onChange={(e) => setNewEmployee({ ...newEmployee, email: e.target.value })}
                      className="bg-slate-700 border-slate-600 text-white"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label className="text-slate-300">ตำแหน่ง</Label>
                      <Input
                        placeholder="ตำแหน่ง..."
                        value={newEmployee.role}
                        onChange={(e) => setNewEmployee({ ...newEmployee, role: e.target.value })}
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-slate-300">แผนก</Label>
                      <Input
                        placeholder="แผนก..."
                        value={newEmployee.department}
                        onChange={(e) => setNewEmployee({ ...newEmployee, department: e.target.value })}
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                  </div>
                  <Button
                    onClick={() => void handleCreateEmployee()}
                    className="w-full bg-green-600 hover:bg-green-700"
                    disabled={isCreatingEmployee}
                  >
                    {isCreatingEmployee ? "กำลังบันทึก..." : "✅ บันทึกพนักงาน"}
                  </Button>
                </div>
              )}

              <Separator className="bg-slate-700" />

              {/* Enrollment button */}
              {isMultiCaptureMode && isMultiCaptureComplete ? (
                <Button 
                  onClick={() => void handleCompleteMultiEnrollment()} 
                  className="w-full bg-green-600 hover:bg-green-700"
                >
                  ✅ บันทึกใบหน้า ({viewModel.multiAngleState?.capturedEntries.length} มุม)
                </Button>
              ) : enrollmentMode === "single" ? (
                <Button 
                  onClick={() => void handleSingleEnroll()} 
                  className="w-full"
                  disabled={!viewModel.snapshot || !selectedEmployeeId}
                >
                  บันทึกใบหน้า
                </Button>
              ) : null}
            </CardContent>
          </Card>

          {/* Employee List */}
          <Card className="lg:col-span-2 bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center justify-between">
                <span>รายชื่อพนักงาน</span>
                <Badge variant="outline" className="text-slate-400">
                  {enrolledCount}/{viewModel.employees.length} ลงทะเบียนแล้ว
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {viewModel.employees.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <p>ยังไม่มีพนักงาน</p>
                  <p className="text-sm">กดปุ่ม "เพิ่มพนักงานใหม่" เพื่อเริ่มต้น</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {viewModel.employees.map((emp) => {
                    const embeddingCount = emp.embeddings?.entries?.length ?? (emp.embedding?.vector?.length ? 1 : 0);
                    const hasMulti = emp.embeddings?.entries?.length;
                    const hasSingle = emp.embedding?.vector?.length;
                    const progressPercent = (embeddingCount / PROGRESSIVE_LEARNING_CONFIG.MAX_EMBEDDINGS) * 100;
                    const isMaxed = embeddingCount >= PROGRESSIVE_LEARNING_CONFIG.MAX_EMBEDDINGS;
                    
                    return (
                      <div
                        key={emp.id}
                        className={cn(
                          "flex flex-col gap-3 p-4 rounded-xl border transition-colors cursor-pointer",
                          hasMulti 
                            ? "bg-green-500/10 border-green-500/30 hover:bg-green-500/20" 
                            : hasSingle
                              ? "bg-yellow-500/10 border-yellow-500/30 hover:bg-yellow-500/20"
                              : "bg-slate-700/50 border-slate-600 hover:bg-slate-700",
                          selectedEmployeeId === emp.id && "ring-2 ring-blue-500"
                        )}
                        onClick={() => setSelectedEmployeeId(emp.id)}
                      >
                        <div className="flex items-center gap-4">
                          <Avatar className="h-12 w-12">
                            <AvatarImage src={emp.avatarUrl} alt={emp.fullName} />
                            <AvatarFallback>{emp.fullName.slice(0, 2).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-white truncate">{emp.fullName}</p>
                            <p className="text-sm text-slate-400 truncate">{emp.role}</p>
                          </div>
                          {embeddingCount > 0 ? (
                            <Badge className={cn(
                              isMaxed 
                                ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                                : hasMulti
                                  ? "bg-green-500/20 text-green-400 border-green-500/30"
                                  : "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
                            )}>
                              {isMaxed ? "🎯 " : ""}{embeddingCount}/{PROGRESSIVE_LEARNING_CONFIG.MAX_EMBEDDINGS}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-slate-500">ไม่มี</Badge>
                          )}
                        </div>
                        {/* Progressive learning progress bar */}
                        {embeddingCount > 0 && (
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-slate-400">การเรียนรู้ใบหน้า</span>
                              <span className={cn(
                                isMaxed ? "text-blue-400" : "text-slate-400"
                              )}>
                                {isMaxed ? "สูงสุด ✓" : `${Math.round(progressPercent)}%`}
                              </span>
                            </div>
                            <Progress 
                              value={progressPercent} 
                              className={cn(
                                "h-1.5",
                                isMaxed && "[&>div]:bg-blue-500"
                              )}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
