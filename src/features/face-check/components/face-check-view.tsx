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
import { FaceCaptureSection } from "./face-capture-section";
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
  memory: "In-memory mock data",
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
      ? "Live data via Supabase — add your credentials to NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY."
      : "Using local mock data so you can demo the workflow without credentials.";

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
      title="Face Recognition Check-In"
      subtitle="Capture an employee photo, compare embeddings, and persist the event."
      rightSlot={
        <Badge variant="outline" className="text-xs">
          {repositoryLabel[repositoryKind]}
        </Badge>
      }
    >
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Employee selection</CardTitle>
            <CardDescription>Choose who is trying to check in.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="employee">Employee</Label>
              <Select value={selectedEmployeeId} onValueChange={handleEmployeeChange}>
                <SelectTrigger id="employee" className="w-full">
                  <SelectValue placeholder="Select an employee" />
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
                    Last check-in · {formatRelativeTime(selectedEmployee.lastCheckIn)}
                  </p>
                </div>
                <Badge variant={selectedEmployee.embedding ? "default" : "secondary"}>
                  {selectedEmployee.embedding ? "Enrolled" : "Needs baseline"}
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
            <CardTitle>System status</CardTitle>
            <CardDescription>Live insight into the processing pipeline.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <div className="flex items-center justify-between">
              <span>Phase</span>
              <span className="font-medium text-foreground">{status.phase}</span>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span>Employee records</span>
              <span className="font-medium text-foreground">
                {status.isLoadingEmployees ? "Loading" : `${employees.length} available`}
              </span>
            </div>
            <Separator />
            <div className="space-y-1">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Repository</span>
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
          <AlertTitle>Supabase credentials required</AlertTitle>
          <AlertDescription>
            Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then restart the dev server to
            persist check-ins remotely.
          </AlertDescription>
        </Alert>
      </div>
    </AppShell>
  );
};
