"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createEmployeeRepository } from "@/shared/repositories/employee-repository";
import type { FaceCheckEvent, Employee } from "@/entities/employee";
import { cn } from "@/lib/utils";

export default function HistoryPage() {
  const repository = useMemo(() => createEmployeeRepository(), []);
  const [events, setEvents] = useState<FaceCheckEvent[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split("T")[0]
  );

  // Load data
  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      try {
        const [eventsData, employeesData] = await Promise.all([
          repository.listCheckInEvents(),
          repository.listEmployees(),
        ]);
        setEvents(eventsData);
        setEmployees(employeesData);
      } catch (err) {
        console.error("Failed to load data:", err);
      } finally {
        setIsLoading(false);
      }
    };
    void loadData();

    // Subscribe to real-time updates
    const unsubEvents = repository.subscribeToCheckIns((newEvents) => {
      setEvents(newEvents);
    });
    const unsubEmployees = repository.subscribe((newEmployees) => {
      setEmployees(newEmployees);
    });

    return () => {
      unsubEvents();
      unsubEmployees();
    };
  }, [repository]);

  // Filter events by date
  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      const eventDate = new Date(event.capturedAt).toISOString().split("T")[0];
      return eventDate === selectedDate;
    });
  }, [events, selectedDate]);

  // Group events by hour for timeline
  const groupedByHour = useMemo(() => {
    const groups: Record<string, FaceCheckEvent[]> = {};
    for (const event of filteredEvents) {
      const hour = new Date(event.capturedAt).getHours().toString().padStart(2, "0") + ":00";
      if (!groups[hour]) groups[hour] = [];
      groups[hour].push(event);
    }
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a)); // Latest first
  }, [filteredEvents]);

  // Get employee info
  const getEmployee = (employeeId: string) => {
    return employees.find((e) => e.id === employeeId);
  };

  // Get unique dates from events
  const availableDates = useMemo(() => {
    const dates = new Set<string>();
    for (const event of events) {
      dates.add(new Date(event.capturedAt).toISOString().split("T")[0]);
    }
    return Array.from(dates).sort().reverse();
  }, [events]);

  // Stats for selected date
  const stats = useMemo(() => {
    const uniqueEmployees = new Set(filteredEvents.map((e) => e.employeeId));
    return {
      totalCheckIns: filteredEvents.length,
      uniqueEmployees: uniqueEmployees.size,
      avgSimilarity: filteredEvents.length > 0
        ? filteredEvents.reduce((sum, e) => sum + e.similarityScore, 0) / filteredEvents.length
        : 0,
    };
  }, [filteredEvents]);

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString("th-TH", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("th-TH", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-slate-900/80 backdrop-blur-lg border-b border-slate-700">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">ประวัติการเช็คอิน</h1>
            <p className="text-sm text-slate-400">{formatDate(selectedDate)}</p>
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

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Date selector */}
        <div className="flex gap-2 overflow-x-auto pb-2">
          {availableDates.length === 0 && (
            <Badge variant="outline" className="text-slate-400">
              ยังไม่มีประวัติ
            </Badge>
          )}
          {availableDates.slice(0, 7).map((date) => (
            <button
              key={date}
              onClick={() => setSelectedDate(date)}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap",
                date === selectedDate
                  ? "bg-blue-600 text-white"
                  : "bg-slate-800 text-slate-400 hover:bg-slate-700"
              )}
            >
              {date === new Date().toISOString().split("T")[0]
                ? "วันนี้"
                : new Date(date).toLocaleDateString("th-TH", { day: "numeric", month: "short" })}
            </button>
          ))}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="py-4 text-center">
              <p className="text-3xl font-bold text-white">{stats.totalCheckIns}</p>
              <p className="text-sm text-slate-400">การเช็คอิน</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="py-4 text-center">
              <p className="text-3xl font-bold text-white">{stats.uniqueEmployees}</p>
              <p className="text-sm text-slate-400">พนักงาน</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="py-4 text-center">
              <p className="text-3xl font-bold text-white">{Math.round(stats.avgSimilarity * 100)}%</p>
              <p className="text-sm text-slate-400">ความแม่นยำเฉลี่ย</p>
            </CardContent>
          </Card>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="text-center py-12">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-slate-400">กำลังโหลดข้อมูล...</p>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && filteredEvents.length === 0 && (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="py-12 text-center">
              <p className="text-4xl mb-4">📭</p>
              <p className="text-slate-400">ไม่มีประวัติการเช็คอินในวันที่เลือก</p>
            </CardContent>
          </Card>
        )}

        {/* Timeline by hour */}
        {!isLoading && groupedByHour.length > 0 && (
          <div className="space-y-6">
            {groupedByHour.map(([hour, hourEvents]) => (
              <div key={hour}>
                <div className="flex items-center gap-3 mb-4">
                  <div className="text-lg font-bold text-white">{hour}</div>
                  <Badge className="bg-slate-700 text-slate-300">
                    {hourEvents.length} เช็คอิน
                  </Badge>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {hourEvents.map((event) => {
                    const employee = getEmployee(event.employeeId);
                    return (
                      <Card 
                        key={event.id} 
                        className="bg-slate-800/50 border-slate-700 hover:bg-slate-800 transition-colors overflow-hidden"
                      >
                        <CardContent className="p-0">
                          <div className="flex">
                            {/* Snapshot image */}
                            <div className="w-24 h-24 bg-slate-700 flex-shrink-0">
                              {event.snapshot ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={event.snapshot}
                                  alt={employee?.fullName ?? "Check-in"}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <Avatar className="w-16 h-16">
                                    <AvatarImage src={employee?.avatarUrl} />
                                    <AvatarFallback className="bg-slate-600 text-white text-xl">
                                      {employee?.fullName?.slice(0, 2).toUpperCase() ?? "?"}
                                    </AvatarFallback>
                                  </Avatar>
                                </div>
                              )}
                            </div>

                            {/* Info */}
                            <div className="flex-1 p-3">
                              <p className="font-medium text-white truncate">
                                {employee?.fullName ?? "Unknown"}
                              </p>
                              <p className="text-sm text-slate-400 mt-0.5">
                                {formatTime(event.capturedAt)}
                              </p>
                              <div className="flex items-center gap-2 mt-2">
                                <Badge 
                                  className={cn(
                                    "text-xs",
                                    event.similarityScore >= 0.85 
                                      ? "bg-green-500/20 text-green-400"
                                      : event.similarityScore >= 0.75
                                        ? "bg-blue-500/20 text-blue-400"
                                        : "bg-yellow-500/20 text-yellow-400"
                                  )}
                                >
                                  {Math.round(event.similarityScore * 100)}%
                                </Badge>
                                {employee?.department && (
                                  <span className="text-xs text-slate-500 truncate">
                                    {employee.department}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

