"use client";

import { useMemo } from "react";
import { KioskView } from "../components/kiosk-view";
import { useFaceCheckViewModel } from "../hooks/use-face-check-view-model";
import { createEmployeeRepository } from "@/shared/repositories/employee-repository";

export const KioskContainer = () => {
  const repository = useMemo(() => createEmployeeRepository(), []);
  const viewModel = useFaceCheckViewModel({ repository, autoStart: true });

  return (
    <KioskView
      employees={viewModel.employees}
      detectedEmployee={viewModel.detectedEmployee}
      status={viewModel.status}
      videoRef={viewModel.videoRef}
      matchResult={viewModel.matchResult}
      error={viewModel.error}
      detectedFaces={viewModel.detectedFaces}
      checkInLogs={viewModel.checkInLogs}
      getVideoDimensions={viewModel.getVideoDimensions}
      actions={viewModel.actions}
    />
  );
};

