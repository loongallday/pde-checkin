"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { useFaceCheckViewModel } from "@/features/face-check/hooks/use-face-check-view-model";
import { createEmployeeRepository } from "@/shared/repositories/employee-repository";
import { cn } from "@/lib/utils";

export default function AdminPage() {
  const repository = useMemo(() => createEmployeeRepository(), []);
  const viewModel = useFaceCheckViewModel({ repository, autoStart: false });
  
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [newEmployeeName, setNewEmployeeName] = useState("");
  const [isCapturing, setIsCapturing] = useState(false);

  const enrolledCount = viewModel.employees.filter((emp) => emp.embedding?.vector?.length).length;

  const handleStartCamera = async () => {
    await viewModel.actions.initializeCamera();
  };

  const handleCapture = async () => {
    if (!selectedEmployeeId && !newEmployeeName.trim()) {
      toast.error("กรุณาเลือกพนักงานหรือใส่ชื่อ");
      return;
    }

    setIsCapturing(true);
    try {
      const success = await viewModel.actions.captureForEnrollment();
      if (success) {
        toast.success("ถ่ายภาพสำเร็จ!");
      }
    } finally {
      setIsCapturing(false);
    }
  };

  const handleEnroll = async () => {
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

  const isCameraReady = viewModel.status.phase === "camera-ready" || viewModel.status.phase === "capturing";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white">Admin Panel</h1>
            <p className="text-slate-400 mt-1">จัดการพนักงานและลงทะเบียนใบหน้า</p>
          </div>
          <Link href="/kiosk">
            <Button variant="outline" className="gap-2">
              <span>📺</span>
              เปิด Kiosk Mode
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Camera Section */}
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white">กล้องลงทะเบียน</CardTitle>
              <CardDescription className="text-slate-400">ถ่ายภาพใบหน้าเพื่อลงทะเบียนพนักงาน</CardDescription>
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
                {viewModel.snapshot && (
                  <div className="absolute bottom-3 right-3 w-24 h-24 rounded-lg border-2 border-white overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={viewModel.snapshot} alt="Captured" className="w-full h-full object-cover" />
                  </div>
                )}
              </div>

              <div className="flex gap-3">
                <Button 
                  onClick={() => void handleStartCamera()} 
                  variant="outline" 
                  className="flex-1"
                  disabled={isCameraReady}
                >
                  {isCameraReady ? "กล้องพร้อมแล้ว" : "เริ่มกล้อง"}
                </Button>
                <Button 
                  onClick={() => void handleCapture()} 
                  className="flex-1"
                  disabled={!isCameraReady || isCapturing}
                >
                  {isCapturing ? "กำลังถ่าย..." : "📸 ถ่ายภาพ"}
                </Button>
              </div>

              {viewModel.error && (
                <p className="text-red-400 text-sm">{viewModel.error}</p>
              )}
            </CardContent>
          </Card>

          {/* Enrollment Form */}
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white">ลงทะเบียนใบหน้า</CardTitle>
              <CardDescription className="text-slate-400">
                เลือกพนักงานและบันทึกใบหน้า
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-slate-300">เลือกพนักงาน</Label>
                <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                  <SelectTrigger className="bg-slate-700 border-slate-600 text-white">
                    <SelectValue placeholder="เลือกพนักงาน..." />
                  </SelectTrigger>
                  <SelectContent>
                    {viewModel.employees.map((emp) => (
                      <SelectItem key={emp.id} value={emp.id}>
                        <div className="flex items-center gap-2">
                          <span>{emp.fullName}</span>
                          {emp.embedding && <Badge variant="secondary" className="text-xs">ลงทะเบียนแล้ว</Badge>}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="text-center text-slate-500 text-sm">หรือ</div>

              <div className="space-y-2">
                <Label className="text-slate-300">เพิ่มพนักงานใหม่</Label>
                <Input
                  placeholder="ชื่อพนักงานใหม่..."
                  value={newEmployeeName}
                  onChange={(e) => setNewEmployeeName(e.target.value)}
                  className="bg-slate-700 border-slate-600 text-white"
                />
              </div>

              <Button 
                onClick={() => void handleEnroll()} 
                className="w-full"
                disabled={!viewModel.snapshot || !selectedEmployeeId}
              >
                บันทึกใบหน้า
              </Button>
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
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {viewModel.employees.map((emp) => (
                  <div
                    key={emp.id}
                    className={cn(
                      "flex items-center gap-4 p-4 rounded-xl border transition-colors cursor-pointer",
                      emp.embedding 
                        ? "bg-green-500/10 border-green-500/30 hover:bg-green-500/20" 
                        : "bg-slate-700/50 border-slate-600 hover:bg-slate-700",
                      selectedEmployeeId === emp.id && "ring-2 ring-blue-500"
                    )}
                    onClick={() => setSelectedEmployeeId(emp.id)}
                  >
                    <Avatar className="h-12 w-12">
                      <AvatarImage src={emp.avatarUrl} alt={emp.fullName} />
                      <AvatarFallback>{emp.fullName.slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-white truncate">{emp.fullName}</p>
                      <p className="text-sm text-slate-400 truncate">{emp.role}</p>
                    </div>
                    {emp.embedding ? (
                      <Badge className="bg-green-500/20 text-green-400 border-green-500/30">✓</Badge>
                    ) : (
                      <Badge variant="outline" className="text-slate-500">ไม่มี</Badge>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

