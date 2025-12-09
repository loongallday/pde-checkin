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
import { createEmployeeRepository } from "@/shared/repositories/employee-repository";
import { 
  initializeFaceDetection, 
  isFaceDetectionReady,
  captureEmbeddingFromVideoAsync,
  createFaceEmbeddings,
} from "@/shared/lib/face-embedding";
import { cn } from "@/lib/utils";
import type { Employee, FaceEmbeddingEntry } from "@/entities/employee";
import { PROGRESSIVE_LEARNING_CONFIG } from "@/entities/employee";

// Simple 5 photos registration
const REQUIRED_PHOTOS = 5;

export default function AdminPage() {
  const repository = useMemo(() => createEmployeeRepository(), []);
  
  // State
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoadingEmployees, setIsLoadingEmployees] = useState(true);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [modelsReady, setModelsReady] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [capturedPhotos, setCapturedPhotos] = useState<FaceEmbeddingEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  // Form state
  const [employeeName, setEmployeeName] = useState("");
  const [employeeEmail, setEmployeeEmail] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  // Refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Load models on mount
  useEffect(() => {
    const loadModels = async () => {
      const loaded = await initializeFaceDetection();
      setModelsReady(loaded);
    };
    loadModels();
  }, []);

  // Load employees
  useEffect(() => {
    const load = async () => {
      setIsLoadingEmployees(true);
      try {
        const data = await repository.listEmployees();
        setEmployees(data);
      } catch (err) {
        console.error("Failed to load employees:", err);
      } finally {
        setIsLoadingEmployees(false);
      }
    };
    load();

    const unsubscribe = repository.subscribe(setEmployees);
    return () => unsubscribe();
  }, [repository]);

  // Start camera
  const startCamera = useCallback(async () => {
    if (!navigator?.mediaDevices?.getUserMedia) {
      setError("อุปกรณ์ไม่รองรับกล้อง");
      return false;
    }

    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      streamRef.current = stream;
      setIsCameraReady(true);
      setError(null);
      return true;
    } catch (err) {
      setError("ไม่สามารถเปิดกล้องได้");
      return false;
    }
  }, []);

  // Stop camera
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsCameraReady(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => stopCamera, [stopCamera]);

  // Quick add employee
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
      setCapturedPhotos([]);
      setEmployeeName("");
      setEmployeeEmail("");
      await startCamera();
    } catch (err) {
      toast.error("ไม่สามารถเพิ่มพนักงานได้");
    } finally {
      setIsCreating(false);
    }
  };

  // Select employee for enrollment
  const handleSelectEmployee = async (emp: Employee) => {
    setSelectedEmployee(emp);
    setCapturedPhotos([]);
    setError(null);
    await startCamera();
  };

  // Capture one photo - SIMPLE, just press button
  const handleCapturePhoto = async () => {
    if (!videoRef.current || !isCameraReady) {
      setError("กล้องยังไม่พร้อม");
      return;
    }

    setIsCapturing(true);
    setError(null);

    try {
      const result = await captureEmbeddingFromVideoAsync(videoRef.current);
      
      if (!result.faceDetected || result.embedding.length === 0) {
        setError("ไม่พบใบหน้า - กรุณาหันหน้าเข้าหากล้อง");
        return;
      }

      const entry: FaceEmbeddingEntry = {
        vector: result.embedding,
        angle: "front",
        createdAt: new Date().toISOString(),
        quality: result.confidence ?? 0.9,
      };

      setCapturedPhotos(prev => [...prev, entry]);
      toast.success(`ถ่ายภาพที่ ${capturedPhotos.length + 1} สำเร็จ!`);
    } catch (err) {
      setError("ไม่สามารถถ่ายภาพได้");
    } finally {
      setIsCapturing(false);
    }
  };

  // Complete enrollment
  const handleComplete = async () => {
    if (!selectedEmployee || capturedPhotos.length < REQUIRED_PHOTOS) return;

    try {
      const embeddings = createFaceEmbeddings(capturedPhotos, true);
      await repository.upsertEmbeddings(selectedEmployee.id, embeddings);
      
      toast.success(`ลงทะเบียน ${selectedEmployee.fullName} สำเร็จ!`);
      
      // Reset
      setSelectedEmployee(null);
      setCapturedPhotos([]);
      stopCamera();
    } catch (err) {
      toast.error("ไม่สามารถบันทึกได้");
    }
  };

  // Cancel enrollment
  const handleCancel = () => {
    setSelectedEmployee(null);
    setCapturedPhotos([]);
    setError(null);
    stopCamera();
  };

  // Delete employee
  const handleDelete = async (emp: Employee) => {
    if (!confirm(`ต้องการลบ ${emp.fullName}?`)) return;
    
    try {
      await repository.deleteEmployee(emp.id);
      toast.success("ลบพนักงานสำเร็จ");
    } catch {
      toast.error("ไม่สามารถลบได้");
    }
  };

  // Re-enroll
  const handleReEnroll = async (emp: Employee) => {
    try {
      await repository.clearEmbeddings(emp.id);
      await handleSelectEmployee(emp);
      toast.info("พร้อมลงทะเบียนใหม่");
    } catch {
      toast.error("เกิดข้อผิดพลาด");
    }
  };

  const enrolledCount = employees.filter(
    emp => emp.embeddings?.entries?.length || emp.embedding?.vector?.length
  ).length;

  const isEnrollmentMode = selectedEmployee !== null;
  const progress = (capturedPhotos.length / REQUIRED_PHOTOS) * 100;
  const canComplete = capturedPhotos.length >= REQUIRED_PHOTOS;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-slate-900/80 backdrop-blur-lg border-b border-slate-700">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">ตั้งค่าระบบ</h1>
            <p className="text-sm text-slate-400">
              {enrolledCount}/{employees.length} พนักงานลงทะเบียนแล้ว
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge className={cn(
              "text-xs",
              modelsReady ? "bg-green-500/20 text-green-400" : "bg-yellow-500/20 text-yellow-400"
            )}>
              {modelsReady ? "🟢 พร้อม" : "🟡 กำลังโหลด..."}
            </Badge>
            <Link href="/kiosk">
              <Button size="sm" className="bg-blue-600 hover:bg-blue-700">
                เปิด Kiosk
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Enrollment Mode */}
        {isEnrollmentMode ? (
          <div className="space-y-4">
            {/* Header */}
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
                      <p className="text-sm text-slate-400">
                        ถ่ายภาพ {capturedPhotos.length}/{REQUIRED_PHOTOS}
                      </p>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={handleCancel} className="text-slate-400">
                    ✕ ยกเลิก
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Camera */}
            <Card className="bg-slate-800/50 border-slate-700 overflow-hidden">
              <div className="relative aspect-[4/3] bg-black">
                <video
                  ref={videoRef}
                  className="h-full w-full object-cover scale-x-[-1]"
                  playsInline
                  muted
                  autoPlay
                />
                
                {!isCameraReady && (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80">
                    <div className="animate-spin w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full" />
                  </div>
                )}

                {/* Progress */}
                <div className="absolute bottom-4 left-4 right-4">
                  <div className="bg-black/80 rounded-xl p-4">
                    <div className="flex justify-between text-white mb-2">
                      <span className="font-semibold">ภาพที่ถ่าย</span>
                      <span>{capturedPhotos.length}/{REQUIRED_PHOTOS}</span>
                    </div>
                    <Progress value={progress} className="h-2" />
                  </div>
                </div>
              </div>

              {/* Controls */}
              <div className="p-4 space-y-3">
                {!canComplete ? (
                  <Button 
                    onClick={handleCapturePhoto}
                    disabled={isCapturing || !isCameraReady || !modelsReady}
                    className="w-full bg-blue-600 hover:bg-blue-700 h-14 text-lg"
                  >
                    {isCapturing ? "📸 กำลังถ่าย..." : `📸 ถ่ายภาพ (${capturedPhotos.length + 1}/${REQUIRED_PHOTOS})`}
                  </Button>
                ) : (
                  <Button 
                    onClick={handleComplete}
                    className="w-full bg-green-600 hover:bg-green-700 h-14 text-lg"
                  >
                    ✅ บันทึกใบหน้า ({REQUIRED_PHOTOS} ภาพ)
                  </Button>
                )}

                {error && (
                  <Alert variant="destructive" className="bg-red-500/10 border-red-500/30">
                    <AlertTitle className="text-red-400">เกิดข้อผิดพลาด</AlertTitle>
                    <AlertDescription className="text-red-300">{error}</AlertDescription>
                  </Alert>
                )}

                <p className="text-center text-slate-400 text-sm">
                  💡 กดปุ่มถ่ายภาพ {REQUIRED_PHOTOS} ครั้ง - ลองหันหน้าหลายๆ มุม
                </p>
              </div>
            </Card>
          </div>
        ) : (
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
                  />
                </div>
                <Button 
                  onClick={() => void handleQuickAdd()}
                  disabled={!employeeName.trim() || isCreating || !modelsReady}
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
                {isLoadingEmployees ? (
                  <div className="text-center py-12 text-slate-500">
                    <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
                    <p>กำลังโหลด...</p>
                  </div>
                ) : employees.length === 0 ? (
                  <div className="text-center py-12 text-slate-500">
                    <p className="text-4xl mb-3">👆</p>
                    <p>ยังไม่มีพนักงาน</p>
                    <p className="text-sm">เพิ่มพนักงานคนแรกด้านบน</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {employees.map((emp) => {
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
                              <Badge className={cn(
                                "text-xs mt-1",
                                isEnrolled 
                                  ? "bg-green-500/20 text-green-400" 
                                  : "bg-yellow-500/20 text-yellow-400"
                              )}>
                                {isEnrolled 
                                  ? `✅ ${embeddingCount} ภาพ`
                                  : "⚠️ ยังไม่ลงทะเบียน"
                                }
                              </Badge>
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
                                  onClick={() => void handleSelectEmployee(emp)}
                                  disabled={!modelsReady}
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
      </main>
    </div>
  );
}
