"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { createEmployeeRepository } from "@/shared/repositories/employee-repository";
import type { Employee, FaceAngle, FaceEmbeddingEntry, FaceCheckEvent } from "@/entities/employee";
import { PROGRESSIVE_LEARNING_CONFIG } from "@/entities/employee";
import { cn } from "@/lib/utils";

// Angle display labels
const ANGLE_LABELS: Record<FaceAngle, { label: string; icon: string }> = {
  front: { label: "หน้าตรง", icon: "👁️" },
  "slight-left": { label: "เฉียงซ้าย", icon: "↖️" },
  "slight-right": { label: "เฉียงขวา", icon: "↗️" },
  left: { label: "หันซ้าย", icon: "⬅️" },
  right: { label: "หันขวา", icon: "➡️" },
};

// Quality tier display
const getQualityTier = (quality: number | undefined): { label: string; color: string } => {
  if (!quality) return { label: "ไม่ระบุ", color: "bg-slate-500/20 text-slate-400" };
  if (quality >= 0.9) return { label: "ดีเยี่ยม", color: "bg-emerald-500/20 text-emerald-400" };
  if (quality >= 0.8) return { label: "ดีมาก", color: "bg-green-500/20 text-green-400" };
  if (quality >= 0.7) return { label: "ดี", color: "bg-blue-500/20 text-blue-400" };
  if (quality >= 0.6) return { label: "ปานกลาง", color: "bg-yellow-500/20 text-yellow-400" };
  return { label: "ต้องปรับปรุง", color: "bg-orange-500/20 text-orange-400" };
};

// Employee detail card
const EmployeeDetailCard = ({ 
  employee, 
  isExpanded, 
  onToggle,
  checkInEvents = [],
}: { 
  employee: Employee; 
  isExpanded: boolean;
  onToggle: () => void;
  checkInEvents?: FaceCheckEvent[];
}) => {
  const embeddings = employee.embeddings;
  const entries = embeddings?.entries ?? [];
  const hasLegacyEmbedding = Boolean(employee.embedding?.vector?.length);
  const isEnrolled = entries.length > 0 || hasLegacyEmbedding;
  const embeddingCount = entries.length || (hasLegacyEmbedding ? 1 : 0);
  const progress = (embeddingCount / PROGRESSIVE_LEARNING_CONFIG.MAX_EMBEDDINGS) * 100;

  // Group entries by angle
  const entriesByAngle = useMemo(() => {
    const grouped: Record<FaceAngle, FaceEmbeddingEntry[]> = {
      front: [],
      "slight-left": [],
      "slight-right": [],
      left: [],
      right: [],
    };
    for (const entry of entries) {
      if (entry.angle in grouped) {
        grouped[entry.angle].push(entry);
      }
    }
    return grouped;
  }, [entries]);

  // Average quality
  const avgQuality = useMemo(() => {
    const withQuality = entries.filter((e) => e.quality !== undefined);
    if (withQuality.length === 0) return undefined;
    return withQuality.reduce((sum, e) => sum + (e.quality ?? 0), 0) / withQuality.length;
  }, [entries]);

  const qualityTier = getQualityTier(avgQuality);

  return (
    <Card 
      className={cn(
        "bg-slate-800/50 border-slate-700 transition-all hover:bg-slate-800/70 overflow-hidden",
        isExpanded && "ring-2 ring-blue-500/50"
      )}
    >
      {/* Main row - clickable */}
      <div 
        className="p-4 cursor-pointer"
        onClick={onToggle}
      >
        <div className="flex items-center gap-4">
          {/* Avatar */}
          <Avatar className={cn(
            "h-16 w-16 ring-2 flex-shrink-0 transition-all",
            isEnrolled ? "ring-green-500/50" : "ring-slate-600"
          )}>
            <AvatarImage src={employee.avatarUrl} />
            <AvatarFallback className={cn(
              "text-lg font-bold",
              isEnrolled ? "bg-green-600/20 text-green-400" : "bg-slate-700 text-slate-400"
            )}>
              {employee.fullName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-white truncate">{employee.fullName}</h3>
              {isEnrolled ? (
                <Badge className="bg-green-500/20 text-green-400 text-xs">
                  ✓ ลงทะเบียนแล้ว
                </Badge>
              ) : (
                <Badge className="bg-yellow-500/20 text-yellow-400 text-xs">
                  ⚠ ยังไม่ลงทะเบียน
                </Badge>
              )}
            </div>
            <p className="text-sm text-slate-400 truncate">{employee.email}</p>
            <div className="flex items-center gap-3 mt-1">
              {employee.role && (
                <span className="text-xs text-slate-500">{employee.role}</span>
              )}
              {employee.department && (
                <span className="text-xs text-slate-500">• {employee.department}</span>
              )}
            </div>
          </div>

          {/* Stats preview */}
          <div className="hidden sm:flex flex-col items-end gap-1">
            {isEnrolled && (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">ภาพใบหน้า</span>
                  <Badge className="bg-slate-700 text-slate-300 text-xs">
                    {embeddingCount}/{PROGRESSIVE_LEARNING_CONFIG.MAX_EMBEDDINGS}
                  </Badge>
                </div>
                {avgQuality !== undefined && (
                  <Badge className={cn("text-xs", qualityTier.color)}>
                    คุณภาพ: {qualityTier.label}
                  </Badge>
                )}
              </>
            )}
          </div>

          {/* Expand indicator */}
          <div className="text-slate-500">
            <svg 
              className={cn("w-5 h-5 transition-transform", isExpanded && "rotate-180")}
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        {/* Progress bar preview */}
        {isEnrolled && !isExpanded && (
          <div className="mt-3 pt-3 border-t border-slate-700/50">
            <div className="flex items-center gap-3">
              <Progress value={progress} className="h-1.5 flex-1" />
              <span className="text-xs text-slate-500 whitespace-nowrap">
                {Math.round(progress)}%
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Expanded details */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-slate-700/50 pt-4">
          {/* Quick stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-900/50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-white">{embeddingCount}</p>
              <p className="text-xs text-slate-400">ภาพใบหน้า</p>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-white">
                {Object.values(entriesByAngle).filter(arr => arr.length > 0).length}
              </p>
              <p className="text-xs text-slate-400">มุมที่บันทึก</p>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-white">
                {avgQuality ? `${Math.round(avgQuality * 100)}%` : "–"}
              </p>
              <p className="text-xs text-slate-400">คุณภาพเฉลี่ย</p>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-3 text-center">
              <p className="text-sm font-medium text-white truncate">
                {employee.lastCheckIn 
                  ? new Date(employee.lastCheckIn).toLocaleDateString("th-TH", { 
                      day: "numeric", 
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit"
                    })
                  : "–"
                }
              </p>
              <p className="text-xs text-slate-400">เช็คอินล่าสุด</p>
            </div>
          </div>

          {/* Face embedding progress */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-300">ความครบถ้วนของข้อมูลใบหน้า</span>
              <span className="text-sm text-slate-400">{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          {/* Face enrollment images gallery */}
          {entries.filter(e => e.imageDataUrl).length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-slate-300">📸 ภาพใบหน้าจากการลงทะเบียน</h4>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                {entries
                  .filter(e => e.imageDataUrl)
                  .map((entry, idx) => (
                    <div 
                      key={idx}
                      className="relative aspect-square rounded-xl overflow-hidden bg-slate-900 group ring-2 ring-slate-700 hover:ring-blue-500/50 transition-all"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={entry.imageDataUrl}
                        alt={`${ANGLE_LABELS[entry.angle]?.label || entry.angle}`}
                        className="w-full h-full object-cover"
                      />
                      {/* Angle badge overlay */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent">
                        <div className="absolute bottom-2 left-2 right-2">
                          <div className="flex items-center justify-between">
                            <Badge className="bg-slate-900/80 text-white text-[10px]">
                              {ANGLE_LABELS[entry.angle]?.icon} {ANGLE_LABELS[entry.angle]?.label}
                            </Badge>
                            {entry.quality !== undefined && (
                              <Badge className={cn(
                                "text-[10px]",
                                getQualityTier(entry.quality).color
                              )}>
                                {Math.round(entry.quality * 100)}%
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* No enrollment images - show check-in snapshots as fallback */}
          {entries.filter(e => e.imageDataUrl).length === 0 && checkInEvents.filter(e => e.snapshot).length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-slate-300">📸 ภาพใบหน้าจากการเช็คอิน</h4>
              <p className="text-xs text-slate-500">ไม่มีภาพจากการลงทะเบียน - แสดงภาพจากการเช็คอินแทน</p>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {checkInEvents
                  .filter(e => e.snapshot)
                  .slice(0, 12)
                  .map((event, idx) => (
                    <div 
                      key={event.id || idx}
                      className="relative aspect-square rounded-lg overflow-hidden bg-slate-900 group"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={event.snapshot}
                        alt={`Check-in ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="absolute bottom-1 left-1 right-1">
                          <Badge 
                            className={cn(
                              "text-[9px] w-full justify-center",
                              event.similarityScore >= 0.85 
                                ? "bg-green-500/80 text-white"
                                : "bg-yellow-500/80 text-white"
                            )}
                          >
                            {Math.round(event.similarityScore * 100)}%
                          </Badge>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Angle breakdown */}
          {entries.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-slate-300">มุมใบหน้าที่บันทึก</h4>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {(Object.entries(ANGLE_LABELS) as [FaceAngle, { label: string; icon: string }][]).map(
                  ([angle, { label, icon }]) => {
                    const angleEntries = entriesByAngle[angle];
                    const hasAngle = angleEntries.length > 0;
                    const bestQuality = angleEntries.length > 0
                      ? Math.max(...angleEntries.map(e => e.quality ?? 0))
                      : 0;

                    return (
                      <div
                        key={angle}
                        className={cn(
                          "rounded-lg p-3 text-center transition-all",
                          hasAngle 
                            ? "bg-green-500/10 border border-green-500/30" 
                            : "bg-slate-900/30 border border-slate-700/50"
                        )}
                      >
                        <span className="text-xl">{icon}</span>
                        <p className={cn(
                          "text-xs mt-1 font-medium",
                          hasAngle ? "text-green-400" : "text-slate-500"
                        )}>
                          {label}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {hasAngle ? `${angleEntries.length} ภาพ` : "ยังไม่มี"}
                        </p>
                        {hasAngle && bestQuality > 0 && (
                          <Badge className={cn(
                            "text-[10px] mt-1",
                            getQualityTier(bestQuality).color
                          )}>
                            {Math.round(bestQuality * 100)}%
                          </Badge>
                        )}
                      </div>
                    );
                  }
                )}
              </div>
            </div>
          )}

          {/* Embedding entries timeline */}
          {entries.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-slate-300">
                ประวัติการบันทึก ({entries.length} รายการ)
              </h4>
              <div className="max-h-48 overflow-y-auto space-y-2 pr-2">
                {[...entries]
                  .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                  .map((entry, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-3 bg-slate-900/30 rounded-lg p-2 text-sm"
                    >
                      <span className="text-lg">
                        {ANGLE_LABELS[entry.angle]?.icon ?? "📸"}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-slate-300 truncate">
                          {ANGLE_LABELS[entry.angle]?.label ?? entry.angle}
                        </p>
                        <p className="text-xs text-slate-500">
                          {new Date(entry.createdAt).toLocaleString("th-TH", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                      {entry.quality !== undefined && (
                        <Badge className={cn("text-xs", getQualityTier(entry.quality).color)}>
                          {Math.round(entry.quality * 100)}%
                        </Badge>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Legacy embedding info */}
          {hasLegacyEmbedding && !entries.length && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
              <div className="flex items-center gap-2 text-yellow-400 text-sm">
                <span>⚠️</span>
                <span>ใช้รูปแบบข้อมูลเก่า (Legacy)</span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                แนะนำให้ลงทะเบียนใหม่เพื่อเพิ่มความแม่นยำในการจดจำ
              </p>
            </div>
          )}

          {/* Not enrolled state */}
          {!isEnrolled && (
            <div className="bg-slate-900/30 rounded-lg p-6 text-center">
              <p className="text-4xl mb-3">📷</p>
              <p className="text-slate-400 mb-4">ยังไม่มีข้อมูลใบหน้า</p>
              <Link href="/admin">
                <Button size="sm" className="bg-blue-600 hover:bg-blue-700">
                  ไปลงทะเบียน →
                </Button>
              </Link>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <Link href="/admin" className="flex-1">
              <Button variant="outline" size="sm" className="w-full">
                {isEnrolled ? "🔄 อัพเดทใบหน้า" : "📸 ลงทะเบียน"}
              </Button>
            </Link>
            <Link href="/history">
              <Button variant="ghost" size="sm">
                📋 ประวัติ
              </Button>
            </Link>
          </div>
        </div>
      )}
    </Card>
  );
};

export default function EmployeesPage() {
  const repository = useMemo(() => createEmployeeRepository(), []);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [checkInEvents, setCheckInEvents] = useState<FaceCheckEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<"all" | "enrolled" | "not-enrolled">("all");

  // Load employees and check-in events
  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      try {
        const [employeesData, eventsData] = await Promise.all([
          repository.listEmployees(),
          repository.listCheckInEvents(200), // Get more events to have snapshots
        ]);
        setEmployees(employeesData);
        setCheckInEvents(eventsData);
      } catch (err) {
        console.error("Failed to load data:", err);
      } finally {
        setIsLoading(false);
      }
    };
    void loadData();

    // Subscribe to real-time updates
    const unsubEmployees = repository.subscribe((newEmployees) => {
      setEmployees(newEmployees);
    });
    const unsubEvents = repository.subscribeToCheckIns((newEvents) => {
      setCheckInEvents(newEvents);
    });

    return () => {
      unsubEmployees();
      unsubEvents();
    };
  }, [repository]);

  // Group check-in events by employee
  const eventsByEmployee = useMemo(() => {
    const grouped: Record<string, FaceCheckEvent[]> = {};
    for (const event of checkInEvents) {
      if (!grouped[event.employeeId]) {
        grouped[event.employeeId] = [];
      }
      grouped[event.employeeId].push(event);
    }
    return grouped;
  }, [checkInEvents]);

  // Filter and search
  const filteredEmployees = useMemo(() => {
    return employees.filter((emp) => {
      // Search filter
      const matchesSearch = searchQuery === "" || 
        emp.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        emp.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (emp.department ?? "").toLowerCase().includes(searchQuery.toLowerCase());

      // Status filter
      const isEnrolled = (emp.embeddings?.entries?.length ?? 0) > 0 || 
        Boolean(emp.embedding?.vector?.length);
      
      if (filterStatus === "enrolled" && !isEnrolled) return false;
      if (filterStatus === "not-enrolled" && isEnrolled) return false;

      return matchesSearch;
    });
  }, [employees, searchQuery, filterStatus]);

  // Stats
  const stats = useMemo(() => {
    const enrolled = employees.filter(
      (e) => (e.embeddings?.entries?.length ?? 0) > 0 || Boolean(e.embedding?.vector?.length)
    );
    const totalEmbeddings = employees.reduce(
      (sum, e) => sum + (e.embeddings?.entries?.length ?? (e.embedding?.vector?.length ? 1 : 0)),
      0
    );
    const avgEmbeddings = enrolled.length > 0 
      ? totalEmbeddings / enrolled.length 
      : 0;

    return {
      total: employees.length,
      enrolled: enrolled.length,
      notEnrolled: employees.length - enrolled.length,
      totalEmbeddings,
      avgEmbeddings: Math.round(avgEmbeddings * 10) / 10,
    };
  }, [employees]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-slate-900/80 backdrop-blur-lg border-b border-slate-700">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">ข้อมูลพนักงาน</h1>
            <p className="text-sm text-slate-400">
              {stats.enrolled}/{stats.total} คนลงทะเบียนใบหน้าแล้ว
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/admin">
              <Button variant="outline" size="sm">
                ⚙️ ตั้งค่า
              </Button>
            </Link>
            <Link href="/kiosk">
              <Button size="sm" className="bg-blue-600 hover:bg-blue-700">
                📺 Kiosk
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Stats cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="py-4 text-center">
              <p className="text-3xl font-bold text-white">{stats.total}</p>
              <p className="text-sm text-slate-400">พนักงานทั้งหมด</p>
            </CardContent>
          </Card>
          <Card className="bg-green-500/10 border-green-500/30">
            <CardContent className="py-4 text-center">
              <p className="text-3xl font-bold text-green-400">{stats.enrolled}</p>
              <p className="text-sm text-slate-400">ลงทะเบียนแล้ว</p>
            </CardContent>
          </Card>
          <Card className="bg-yellow-500/10 border-yellow-500/30">
            <CardContent className="py-4 text-center">
              <p className="text-3xl font-bold text-yellow-400">{stats.notEnrolled}</p>
              <p className="text-sm text-slate-400">รอลงทะเบียน</p>
            </CardContent>
          </Card>
          <Card className="bg-blue-500/10 border-blue-500/30">
            <CardContent className="py-4 text-center">
              <p className="text-3xl font-bold text-blue-400">{stats.totalEmbeddings}</p>
              <p className="text-sm text-slate-400">ภาพใบหน้ารวม</p>
            </CardContent>
          </Card>
        </div>

        {/* Search and filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Input
              placeholder="🔍 ค้นหาชื่อ, อีเมล, แผนก..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-slate-800/50 border-slate-600 text-white pl-4"
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant={filterStatus === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterStatus("all")}
              className={filterStatus === "all" ? "bg-blue-600" : ""}
            >
              ทั้งหมด
            </Button>
            <Button
              variant={filterStatus === "enrolled" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterStatus("enrolled")}
              className={filterStatus === "enrolled" ? "bg-green-600" : ""}
            >
              ✓ ลงทะเบียนแล้ว
            </Button>
            <Button
              variant={filterStatus === "not-enrolled" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterStatus("not-enrolled")}
              className={filterStatus === "not-enrolled" ? "bg-yellow-600" : ""}
            >
              ⚠ รอลงทะเบียน
            </Button>
          </div>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="text-center py-12">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-slate-400">กำลังโหลดข้อมูล...</p>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && filteredEmployees.length === 0 && (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="py-12 text-center">
              {employees.length === 0 ? (
                <>
                  <p className="text-4xl mb-4">👥</p>
                  <p className="text-slate-400 mb-4">ยังไม่มีข้อมูลพนักงาน</p>
                  <Link href="/admin">
                    <Button className="bg-blue-600 hover:bg-blue-700">
                      ➕ เพิ่มพนักงาน
                    </Button>
                  </Link>
                </>
              ) : (
                <>
                  <p className="text-4xl mb-4">🔍</p>
                  <p className="text-slate-400">ไม่พบพนักงานที่ตรงกับเงื่อนไข</p>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Employee list */}
        {!isLoading && filteredEmployees.length > 0 && (
          <div className="space-y-3">
            {filteredEmployees.map((employee) => (
              <EmployeeDetailCard
                key={employee.id}
                employee={employee}
                isExpanded={expandedId === employee.id}
                onToggle={() => setExpandedId(
                  expandedId === employee.id ? null : employee.id
                )}
                checkInEvents={eventsByEmployee[employee.id] ?? []}
              />
            ))}
          </div>
        )}

        {/* Summary footer */}
        {!isLoading && employees.length > 0 && (
          <Card className="bg-slate-800/30 border-slate-700">
            <CardContent className="py-4">
              <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-slate-400">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  <span>ลงทะเบียนแล้ว: {stats.enrolled} คน</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-yellow-500" />
                  <span>รอลงทะเบียน: {stats.notEnrolled} คน</span>
                </div>
                <div className="flex items-center gap-2">
                  <span>📸 ภาพใบหน้าเฉลี่ย: {stats.avgEmbeddings} ภาพ/คน</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}

