import { z } from "zod";
import type { Employee, FaceCheckEventPayload, FaceEmbedding } from "@/entities/employee";
import { mockEmployees } from "@/shared/mocks/employees";
import { getSupabaseClient, hasSupabaseConfig } from "@/shared/services/supabase-client";

const employeeRowSchema = z.object({
  id: z.string(),
  full_name: z.string(),
  email: z.string().email(),
  role: z.string(),
  department: z.string().nullish(),
  avatar_url: z.string().url().nullish(),
  last_check_in: z.string().nullish(),
  embedding_version: z.string().nullish(),
  embedding_vector: z.array(z.number()).nullish(),
});

export type EmployeeRepositoryKind = "supabase" | "memory";

export interface EmployeeRepository {
  kind: EmployeeRepositoryKind;
  listEmployees(): Promise<Employee[]>;
  recordCheckIn(event: FaceCheckEventPayload): Promise<void>;
  upsertEmbedding(employeeId: string, embedding: FaceEmbedding): Promise<void>;
}

class SupabaseEmployeeRepository implements EmployeeRepository {
  kind: EmployeeRepositoryKind = "supabase";

  async listEmployees(): Promise<Employee[]> {
    const client = getSupabaseClient();
    if (!client) {
      throw new Error("ยังไม่ได้ตั้งค่า Supabase");
    }

    const { data, error } = await client
      .from("employees")
      .select(
        "id, full_name, email, role, department, avatar_url, last_check_in, embedding_version, embedding_vector",
      );

    if (error) {
      throw new Error(error.message);
    }

    const rows = z.array(employeeRowSchema).parse(data);

    return rows.map((row) => ({
      id: row.id,
      fullName: row.full_name,
      email: row.email,
      role: row.role,
      department: row.department ?? undefined,
      avatarUrl: row.avatar_url ?? undefined,
      lastCheckIn: row.last_check_in ?? undefined,
      embedding:
        row.embedding_vector && row.embedding_version
          ? {
              version: row.embedding_version as FaceEmbedding["version"],
              createdAt: row.last_check_in ?? new Date().toISOString(),
              source: "camera",
              vector: row.embedding_vector,
            }
          : undefined,
    }));
  }

  async recordCheckIn(event: FaceCheckEventPayload): Promise<void> {
    const client = getSupabaseClient();
    if (!client) {
      throw new Error("ยังไม่ได้ตั้งค่า Supabase");
    }

    const { error: insertError } = await client.from("face_check_events").insert({
      employee_id: event.employeeId,
      captured_at: event.capturedAt,
      similarity_score: event.similarityScore,
      is_match: event.isMatch,
      snapshot: event.snapshotDataUrl,
    });

    if (insertError) {
      throw new Error(insertError.message);
    }

    const { error: updateError } = await client
      .from("employees")
      .update({
        last_check_in: event.capturedAt,
      })
      .eq("id", event.employeeId);

    if (updateError) {
      throw new Error(updateError.message);
    }
  }

  async upsertEmbedding(employeeId: string, embedding: FaceEmbedding): Promise<void> {
    const client = getSupabaseClient();
    if (!client) {
      throw new Error("ยังไม่ได้ตั้งค่า Supabase");
    }

    const { error } = await client
      .from("employees")
      .update({
        embedding_vector: embedding.vector,
        embedding_version: embedding.version,
        last_check_in: embedding.createdAt,
      })
      .eq("id", employeeId);

    if (error) {
      throw new Error(error.message);
    }
  }
}

class InMemoryEmployeeRepository implements EmployeeRepository {
  kind: EmployeeRepositoryKind = "memory";
  private employees = [...mockEmployees];

  async listEmployees(): Promise<Employee[]> {
    return [...this.employees];
  }

  async recordCheckIn(event: FaceCheckEventPayload): Promise<void> {
    this.employees = this.employees.map((employee) =>
      employee.id === event.employeeId
        ? {
            ...employee,
            lastCheckIn: event.capturedAt,
          }
        : employee,
    );
  }

  async upsertEmbedding(employeeId: string, embedding: FaceEmbedding): Promise<void> {
    this.employees = this.employees.map((employee) =>
      employee.id === employeeId
        ? {
            ...employee,
            embedding,
          }
        : employee,
    );
  }
}

let cachedRepo: EmployeeRepository | null = null;

export const createEmployeeRepository = (): EmployeeRepository => {
  if (cachedRepo) return cachedRepo;
  cachedRepo = hasSupabaseConfig() ? new SupabaseEmployeeRepository() : new InMemoryEmployeeRepository();
  return cachedRepo;
};
