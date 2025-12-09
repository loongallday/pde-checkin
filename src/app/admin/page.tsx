"use client";

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

// Helper function to check if angle matches target (same logic as auto-capture)
const checkAngleMatch = (
  targetAngle: FaceAngle | undefined,
  yaw: number,
  pitch: number
): boolean => {
  if (!targetAngle) return false;
  
  // Yaw is already flipped to match user perspective, so left = negative, right = positive
  if (targetAngle === "front") {
    return Math.abs(yaw) <= 10 && Math.abs(pitch - 90) <= 10;
  } else if (targetAngle === "slight-left") {
    return yaw >= -20 && yaw <= -5 && Math.abs(pitch - 90) <= 10;
  } else if (targetAngle === "slight-right") {
    return yaw >= 5 && yaw <= 20 && Math.abs(pitch - 90) <= 10;
  } else if (targetAngle === "left") {
    return yaw >= -35 && yaw <= -20 && Math.abs(pitch - 90) <= 10;
  } else if (targetAngle === "right") {
    return yaw >= 20 && yaw <= 35 && Math.abs(pitch - 90) <= 10;
  }
  return false;
};

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
      "flex items-center gap-3 px-5 py-3 rounded-xl transition-all text-lg font-semibold",
      isComplete && "bg-green-500/30 text-green-300 border-2 border-green-400",
      isActive && !isComplete && "bg-blue-500/30 text-blue-300 border-2 border-blue-400 ring-4 ring-blue-400/50",
      !isActive && !isComplete && "bg-slate-700/50 text-slate-400 border-2 border-slate-600"
    )}>
      <span className="text-2xl">{isComplete ? "✅" : isActive ? "📸" : "⭕"}</span>
      <span>{labels[angle]}</span>
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
  const [autoCaptureStatus, setAutoCaptureStatus] = useState<"idle" | "checking" | "ready" | "capturing">("idle");
  
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

  // Auto-start camera when entering capture step (only once to prevent blinking)
  const cameraInitRef = useRef(false);
  useEffect(() => {
    if (step === "capture" && !isCameraReady && viewModel.status.modelsReady && !cameraInitRef.current) {
      cameraInitRef.current = true;
      void viewModel.actions.initializeCamera();
    }
    // Reset when leaving capture step
    if (step !== "capture") {
      cameraInitRef.current = false;
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
    // Reset countdown state
    if (autoCaptureTimeoutRef.current) {
      clearTimeout(autoCaptureTimeoutRef.current);
      autoCaptureTimeoutRef.current = null;
    }
    isCountingDownRef.current = false;
    lastAutoCaptureRef.current = Date.now(); // Update timestamp to prevent immediate re-capture
    
    try {
      const result = await viewModel.actions.captureMultiAngle();
      if (!result.success) {
        toast.error(result.message);
      } else {
        // Clear quality to force fresh check for next angle
        // The quality monitoring will update it shortly (within 500ms)
        console.log("[AutoCapture] Capture successful, resetting for next angle");
        // Small delay to ensure state updates before next check
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } finally {
      setIsCapturing(false);
    }
  };


  // Complete enrollment
  const handleComplete = useCallback(async () => {
    if (!selectedEmployee) return;
    
    const success = await viewModel.actions.completeMultiAngleEnrollment(selectedEmployee.id);
    if (success) {
      toast.success(`ลงทะเบียนใบหน้า ${selectedEmployee.fullName} สำเร็จ!`);
      setStep("done");
    }
  }, [selectedEmployee, viewModel.actions]);

  // Auto-capture when quality is good and angle matches (with debounce)
  const autoCaptureTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastAutoCaptureRef = useRef<number>(0);
  const isCountingDownRef = useRef<boolean>(false);
  const prevTargetAngleRef = useRef<FaceAngle | undefined>(currentTargetAngle);
  
  // Reset countdown when target angle changes
  useEffect(() => {
    if (prevTargetAngleRef.current !== currentTargetAngle && currentTargetAngle) {
      console.log("[AutoCapture] Target angle changed, resetting countdown", {
        from: prevTargetAngleRef.current,
        to: currentTargetAngle,
        hasQuality: !!viewModel.lastQuality,
      });
      if (autoCaptureTimeoutRef.current) {
        clearTimeout(autoCaptureTimeoutRef.current);
        autoCaptureTimeoutRef.current = null;
      }
      isCountingDownRef.current = false;
      prevTargetAngleRef.current = currentTargetAngle;
      // Reset status to checking to show we're waiting for quality
      setAutoCaptureStatus("checking");
    }
  }, [currentTargetAngle, viewModel.lastQuality]);
  
  useEffect(() => {
    if (!isMultiCaptureMode || !isCameraReady || isCapturing || isMultiCaptureComplete) {
      setAutoCaptureStatus("idle");
      if (autoCaptureTimeoutRef.current) {
        clearTimeout(autoCaptureTimeoutRef.current);
        autoCaptureTimeoutRef.current = null;
      }
      return;
    }

    const quality = viewModel.lastQuality;
    const targetAngle = currentTargetAngle;
    
    if (!targetAngle) {
      setAutoCaptureStatus("idle");
      return;
    }
    
    // If quality is not available yet, show checking status and wait
    if (!quality) {
      console.log("[AutoCapture] Waiting for quality data...", { targetAngle });
      setAutoCaptureStatus("checking");
      return;
    }

    setAutoCaptureStatus("checking");
    
    if (quality.isValid && quality.details.faceAngle.valid) {
      const detectedAngle = quality.details.faceAngle;
      const yaw = detectedAngle.yaw;
      const pitch = detectedAngle.pitch;
      
      console.log("[AutoCapture] Checking angle match", {
        targetAngle,
        yaw,
        pitch,
        qualityScore: quality.score,
        qualityValid: quality.isValid,
        angleValid: quality.details.faceAngle.valid,
      });
      
      // Check if angle matches target (with tolerance)
      // Yaw is already flipped to match user perspective, so left = negative, right = positive
      let angleMatches = false;
      if (targetAngle === "front") {
        angleMatches = Math.abs(yaw) <= 10 && Math.abs(pitch - 90) <= 10;
      } else if (targetAngle === "slight-left") {
        angleMatches = yaw >= -20 && yaw <= -5 && Math.abs(pitch - 90) <= 10;
      } else if (targetAngle === "slight-right") {
        angleMatches = yaw >= 5 && yaw <= 20 && Math.abs(pitch - 90) <= 10;
      } else if (targetAngle === "left") {
        angleMatches = yaw >= -35 && yaw <= -20 && Math.abs(pitch - 90) <= 10;
      } else if (targetAngle === "right") {
        angleMatches = yaw >= 20 && yaw <= 35 && Math.abs(pitch - 90) <= 10;
      }

      console.log("[AutoCapture] Angle match result", {
        angleMatches,
        meetsScore: quality.score >= 0.7,
        willTrigger: angleMatches && quality.score >= 0.7,
      });

      // Auto-capture if everything is good (with 1 second stable requirement)
      if (angleMatches && quality.score >= 0.7) {
        const now = Date.now();
        const timeSinceLastCapture = now - lastAutoCaptureRef.current;
        // Prevent too frequent captures (min 2 seconds between to allow quality to stabilize)
        if (timeSinceLastCapture < 2000) {
          console.log("[AutoCapture] Too soon since last capture", {
            timeSinceLastCapture,
            required: 2000,
          });
          setAutoCaptureStatus("checking");
          return;
        }

        // Only set timeout if one doesn't already exist and we're not counting down
        if (!autoCaptureTimeoutRef.current && !isCountingDownRef.current) {
          console.log("[AutoCapture] Conditions met! Starting 1s countdown...");
          setAutoCaptureStatus("ready");
          isCountingDownRef.current = true;
          
          // Wait 1 second of stable good quality before auto-capturing
          autoCaptureTimeoutRef.current = setTimeout(async () => {
            console.log("[AutoCapture] Countdown complete, checking final conditions...");
            // Clear the timeout ref and countdown flag
            autoCaptureTimeoutRef.current = null;
            isCountingDownRef.current = false;
            
            // Double-check conditions are still good
            const currentQuality = viewModel.lastQuality;
            const currentTarget = currentTargetAngle;
            
            if (!currentQuality || !currentTarget) {
              console.log("[AutoCapture] ❌ No quality or target angle");
              setAutoCaptureStatus("checking");
              return;
            }
            
            if (currentQuality.isValid && currentQuality.details.faceAngle.valid && !isCapturing) {
              const detectedAngle = currentQuality.details.faceAngle;
              const yaw = detectedAngle.yaw;
              const pitch = detectedAngle.pitch;
              
              // Re-check angle match
              // Yaw is already flipped to match user perspective, so left = negative, right = positive
              let stillMatches = false;
              if (currentTarget === "front") {
                stillMatches = Math.abs(yaw) <= 10 && Math.abs(pitch - 90) <= 10;
              } else if (currentTarget === "slight-left") {
                stillMatches = yaw >= -20 && yaw <= -5 && Math.abs(pitch - 90) <= 10;
              } else if (currentTarget === "slight-right") {
                stillMatches = yaw >= 5 && yaw <= 20 && Math.abs(pitch - 90) <= 10;
              } else if (currentTarget === "left") {
                stillMatches = yaw >= -35 && yaw <= -20 && Math.abs(pitch - 90) <= 10;
              } else if (currentTarget === "right") {
                stillMatches = yaw >= 20 && yaw <= 35 && Math.abs(pitch - 90) <= 10;
              }
              
              if (stillMatches && currentQuality.score >= 0.7) {
                console.log("[AutoCapture] ✅ All conditions good, capturing now!");
                setAutoCaptureStatus("capturing");
                lastAutoCaptureRef.current = Date.now();
                await handleCapture();
                setAutoCaptureStatus("idle");
              } else {
                console.log("[AutoCapture] ❌ Conditions changed during countdown", {
                  stillMatches,
                  score: currentQuality.score,
                });
                setAutoCaptureStatus("checking");
              }
            } else {
              console.log("[AutoCapture] ❌ Conditions changed, aborting", {
                hasQuality: !!currentQuality,
                isValid: currentQuality?.isValid,
                angleValid: currentQuality?.details.faceAngle.valid,
                isCapturing,
              });
              setAutoCaptureStatus("checking");
            }
          }, 1000);
        } else if (isCountingDownRef.current) {
          // Timeout already set and counting down, just update status
          setAutoCaptureStatus("ready");
        }
      } else {
        // Clear timeout if conditions not met
        if (autoCaptureTimeoutRef.current) {
          console.log("[AutoCapture] Conditions no longer met, clearing timeout");
          clearTimeout(autoCaptureTimeoutRef.current);
          autoCaptureTimeoutRef.current = null;
          isCountingDownRef.current = false;
        }
        setAutoCaptureStatus("checking");
      }
    } else {
      console.log("[AutoCapture] Quality not valid", {
        qualityValid: quality.isValid,
        angleValid: quality.details.faceAngle?.valid,
      });
      setAutoCaptureStatus("checking");
    }

    // Don't clear timeout in cleanup - let it complete if conditions are met
    // Only clear on unmount or when explicitly needed
    // Don't clear timeout in cleanup - let it complete if conditions are met
    // The timeout will be cleared when conditions change or on capture
    return () => {
      // Cleanup only on unmount or when explicitly needed
      // Don't clear timeout here as it prevents the countdown from completing
    };
  }, [
    isMultiCaptureMode,
    isCameraReady,
    isCapturing,
    isMultiCaptureComplete,
    viewModel.lastQuality,
    currentTargetAngle,
    handleCapture,
  ]);

  // Auto-proceed to next step after capture completes
  useEffect(() => {
    if (isMultiCaptureComplete && !isCapturing) {
      // Small delay before auto-completing
      const timer = setTimeout(() => {
        void handleComplete();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isMultiCaptureComplete, isCapturing, handleComplete]);

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
              <div className="relative aspect-[4/3] bg-black overflow-hidden">
                <video
                  ref={viewModel.videoRef}
                  className="h-full w-full object-cover transition-opacity duration-300 scale-x-[-1]"
                  playsInline
                  muted
                  autoPlay
                />
                
                {/* Loading overlay */}
                {!isCameraReady && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/80">
                    <div className="animate-spin w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full mb-4" />
                    <p className="text-slate-400">กำลังเปิดกล้อง...</p>
                  </div>
                )}

                {/* Concise status indicator at bottom */}
                {isMultiCaptureMode && currentTargetAngle && (
                  <div className="absolute bottom-4 left-4 right-4">
                    <div className="bg-black/85 backdrop-blur rounded-xl p-3 border-2 border-slate-600">
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <div className="text-base font-semibold text-white">
                          {currentTargetAngle === "front" && "👁️ มองตรง"}
                          {currentTargetAngle === "slight-left" && "↖️ เอียงซ้ายเล็กน้อย"}
                          {currentTargetAngle === "slight-right" && "↗️ เอียงขวาเล็กน้อย"}
                          {currentTargetAngle === "left" && "⬅️ หันซ้าย"}
                          {currentTargetAngle === "right" && "➡️ หันขวา"}
                        </div>
                        {viewModel.multiAngleState && (
                          <span className="text-sm text-slate-300 font-medium whitespace-nowrap">
                            {viewModel.multiAngleState.capturedEntries.length}/{viewModel.multiAngleState.targetAngles.length}
                          </span>
                        )}
                      </div>
                      {viewModel.multiAngleState && (
                        <Progress value={multiAngleProgress} className="h-1.5 mb-2" />
                      )}
                      {!viewModel.lastQuality ? (
                        <div className="text-xl text-blue-300 text-center flex items-center justify-center gap-2">
                          <div className="w-3 h-3 bg-blue-400 rounded-full animate-pulse" />
                          กำลังเริ่มตรวจสอบ...
                        </div>
                      ) : (() => {
                        // Check if angle matches target angle (not just general validity)
                        const angle = viewModel.lastQuality.details.faceAngle;
                        const angleMatches = checkAngleMatch(currentTargetAngle, angle.yaw, angle.pitch);
                        const isGoodPosition = viewModel.lastQuality.isValid && 
                                               viewModel.lastQuality.details.faceAngle.valid && 
                                               angleMatches;
                        return !isGoodPosition;
                      })() ? (
                        <div className="text-xl text-yellow-200 text-center space-y-2">
                          {(() => {
                            const angle = viewModel.lastQuality.details.faceAngle;
                            const instructions: string[] = [];
                            
                            // Left/Right instructions (yaw is already flipped to match user perspective, so left = negative, right = positive)
                            if (currentTargetAngle === "front") {
                              if (Math.abs(angle.yaw) > 10) {
                                const degrees = Math.round(Math.abs(angle.yaw));
                                instructions.push(angle.yaw < 0 ? `← หันซ้ายอีก ${degrees}°` : `→ หันขวาอีก ${degrees}°`);
                              }
                            } else if (currentTargetAngle === "slight-left") {
                              const targetYaw = -12.5; // Middle of -5 to -20
                              const diff = Math.round(targetYaw - angle.yaw);
                              if (angle.yaw > -5) {
                                instructions.push(`← หันซ้ายอีก ${Math.abs(diff)}°`);
                              } else if (angle.yaw < -20) {
                                instructions.push(`→ หันขวาอีก ${Math.abs(diff)}°`);
                              }
                            } else if (currentTargetAngle === "slight-right") {
                              const targetYaw = 12.5; // Middle of 5 to 20
                              const diff = Math.round(targetYaw - angle.yaw);
                              if (angle.yaw < 5) {
                                instructions.push(`→ หันขวาอีก ${Math.abs(diff)}°`);
                              } else if (angle.yaw > 20) {
                                instructions.push(`← หันซ้ายอีก ${Math.abs(diff)}°`);
                              }
                            } else if (currentTargetAngle === "left") {
                              const targetYaw = -27.5; // Middle of -20 to -35
                              const diff = Math.round(targetYaw - angle.yaw);
                              if (angle.yaw > -20) {
                                instructions.push(`← หันซ้ายอีก ${Math.abs(diff)}°`);
                              } else if (angle.yaw < -35) {
                                instructions.push(`→ หันขวาอีก ${Math.abs(diff)}°`);
                              }
                            } else if (currentTargetAngle === "right") {
                              const targetYaw = 27.5; // Middle of 20 to 35
                              const diff = Math.round(targetYaw - angle.yaw);
                              if (angle.yaw < 20) {
                                instructions.push(`→ หันขวาอีก ${Math.abs(diff)}°`);
                              } else if (angle.yaw > 35) {
                                instructions.push(`← หันซ้ายอีก ${Math.abs(diff)}°`);
                              }
                            }
                            
                            // Up/Down instructions
                            if (Math.abs(angle.pitch - 90) > 10) {
                              instructions.push(angle.pitch > 90 ? "↓ ก้มลง" : "↑ เงยขึ้น");
                            }
                            
                            // Roll instructions
                            if (Math.abs(angle.roll) > 10) {
                              instructions.push("↔ ตั้งหัวตรง");
                            }
                            
                            return instructions.length > 0 ? instructions : ["ปรับตำแหน่ง"];
                          })().map((instruction, i) => (
                            <div key={i} className="font-semibold">
                              {instruction}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center space-y-1">
                          {viewModel.lastQuality ? (
                            <div className={cn(
                              "text-base px-4 py-1.5 rounded-lg font-bold inline-block",
                              (() => {
                                const angle = viewModel.lastQuality.details.faceAngle;
                                const angleMatches = checkAngleMatch(currentTargetAngle, angle.yaw, angle.pitch);
                                return viewModel.lastQuality.isValid && 
                                       viewModel.lastQuality.details.faceAngle.valid && 
                                       angleMatches;
                              })()
                                ? "bg-green-500/30 text-green-200 border-2 border-green-400"
                                : "bg-yellow-500/30 text-yellow-200 border-2 border-yellow-400"
                            )}>
                              {(() => {
                                const angle = viewModel.lastQuality.details.faceAngle;
                                const angleMatches = checkAngleMatch(currentTargetAngle, angle.yaw, angle.pitch);
                                return viewModel.lastQuality.isValid && 
                                       viewModel.lastQuality.details.faceAngle.valid && 
                                       angleMatches;
                              })() ? "✓ พร้อมถ่าย" : "⚠ ต้องปรับ"}
                            </div>
                          ) : (
                            <div className="text-sm px-4 py-1.5 rounded-lg font-semibold inline-block bg-blue-500/30 text-blue-200 border-2 border-blue-400">
                              🔍 กำลังตรวจสอบ...
                            </div>
                          )}
                          {/* Auto-capture status indicator */}
                          {autoCaptureStatus === "ready" && (
                            <div className="text-xl text-green-300 font-semibold flex items-center justify-center gap-2">
                              <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse" />
                              พร้อมถ่าย (1 วินาที)...
                            </div>
                          )}
                          {autoCaptureStatus === "capturing" && (
                            <div className="text-xl text-yellow-300 font-semibold flex items-center justify-center gap-2">
                              <div className="w-3 h-3 bg-yellow-400 rounded-full animate-pulse" />
                              กำลังถ่ายภาพ...
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Angle indicators */}
              {isMultiCaptureMode && viewModel.multiAngleState && (
                <div className="p-6 bg-slate-900/50 border-t-2 border-slate-700">
                  <div className="flex justify-center gap-3 flex-wrap">
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
                  <Alert variant="destructive" className="bg-red-500/10 border-red-500/30">
                    <AlertTitle className="text-red-400">เกิดข้อผิดพลาด</AlertTitle>
                    <AlertDescription className="text-red-300 text-sm">
                      {viewModel.error}
                      {viewModel.error.includes("มุม") && (
                        <div className="mt-2 space-y-1 text-xs">
                          <p className="font-medium">💡 คำแนะนำ:</p>
                          <ul className="list-disc list-inside space-y-1 ml-2">
                            <li>หันหน้าเข้าหากล้องตรงๆ</li>
                            <li>ตั้งหัวให้ตรง ไม่เอียงไปข้างใดข้างหนึ่ง</li>
                            <li>มองตรงไปที่กล้อง ไม่เงยหรือก้มมากเกินไป</li>
                            <li>ให้ใบหน้าอยู่ตรงกลางกรอบ</li>
                          </ul>
                        </div>
                      )}
                    </AlertDescription>
                  </Alert>
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
