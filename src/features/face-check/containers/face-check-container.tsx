"use client";

import { useMemo } from "react";
import { FaceCheckView } from "../components/face-check-view";
import { useFaceCheckViewModel } from "../hooks/use-face-check-view-model";
import { createEmployeeRepository } from "@/shared/repositories/employee-repository";

export const FaceCheckContainer = () => {
  const repository = useMemo(() => createEmployeeRepository(), []);
  const viewModel = useFaceCheckViewModel({ repository });

  return <FaceCheckView {...viewModel} />;
};
