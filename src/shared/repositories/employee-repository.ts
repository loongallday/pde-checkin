import { z } from "zod";
import type { Employee, FaceCheckEventPayload, FaceEmbedding, FaceEmbeddings, FaceCheckEvent, FaceEmbeddingEntry } from "@/entities/employee";
import { PROGRESSIVE_LEARNING_CONFIG } from "@/entities/employee";
import { mockEmployees } from "@/shared/mocks/employees";
import { getSupabaseClient, hasSupabaseConfig } from "@/shared/services/supabase-client";
import { aggregateEmbedding } from "@/shared/lib/face-embedding";

const embeddingEntrySchema = z.object({
  vector: z.array(z.number()),
  angle: z.enum(["front", "left", "right", "slight-left", "slight-right"]),
  createdAt: z.string(),
  quality: z.number().optional(),
});

const embeddingsSchema = z.object({
  version: z.enum(["simple-v1", "faceapi-v1"]),
  entries: z.array(embeddingEntrySchema),
  averageVector: z.array(z.number()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  source: z.enum(["camera", "uploaded"]),
});

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
  embeddings_data: z.string().nullish(), // JSON string for multi-embeddings
});

export type EmployeeRepositoryKind = "supabase" | "memory";

// Input for creating a new employee
export interface CreateEmployeeInput {
  fullName: string;
  email: string;
  role: string;
  department?: string;
}

// Callback type for real-time updates
export type EmployeeChangeCallback = (employees: Employee[]) => void;
export type CheckInEventCallback = (events: FaceCheckEvent[]) => void;

export interface EmployeeRepository {
  kind: EmployeeRepositoryKind;
  listEmployees(): Promise<Employee[]>;
  getEmployee(employeeId: string): Promise<Employee | null>;
  recordCheckIn(event: FaceCheckEventPayload): Promise<void>;
  upsertEmbedding(employeeId: string, embedding: FaceEmbedding): Promise<void>;
  upsertEmbeddings(employeeId: string, embeddings: FaceEmbeddings): Promise<void>;
  // Progressive learning: append a new embedding to existing ones
  appendEmbedding(employeeId: string, entry: FaceEmbeddingEntry): Promise<{ added: boolean; totalCount: number }>;
  addEmployee(input: CreateEmployeeInput): Promise<Employee>;
  deleteEmployee(employeeId: string): Promise<void>;
  clearEmbeddings(employeeId: string): Promise<void>;
  // Real-time subscription support
  subscribe(callback: EmployeeChangeCallback): () => void;
  // Check-in events
  listCheckInEvents(limit?: number): Promise<FaceCheckEvent[]>;
  subscribeToCheckIns(callback: CheckInEventCallback): () => void;
}

/**
 * Parse embeddings data from JSON string (for Supabase storage)
 */
const parseEmbeddingsData = (jsonStr: string | null | undefined): FaceEmbeddings | undefined => {
  if (!jsonStr) return undefined;
  try {
    const parsed = JSON.parse(jsonStr);
    return embeddingsSchema.parse(parsed);
  } catch {
    return undefined;
  }
};

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
        "id, full_name, email, role, department, avatar_url, last_check_in, embedding_version, embedding_vector, embeddings_data",
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
      // Legacy single embedding (backward compatible)
      embedding:
        row.embedding_vector && row.embedding_version
          ? {
              version: row.embedding_version as FaceEmbedding["version"],
              createdAt: row.last_check_in ?? new Date().toISOString(),
              source: "camera" as const,
              vector: row.embedding_vector,
            }
          : undefined,
      // New multi-embeddings format
      embeddings: parseEmbeddingsData(row.embeddings_data),
    }));
  }

  async getEmployee(employeeId: string): Promise<Employee | null> {
    const client = getSupabaseClient();
    if (!client) {
      throw new Error("ยังไม่ได้ตั้งค่า Supabase");
    }

    const { data, error } = await client
      .from("employees")
      .select(
        "id, full_name, email, role, department, avatar_url, last_check_in, embedding_version, embedding_vector, embeddings_data",
      )
      .eq("id", employeeId)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null; // Not found
      throw new Error(error.message);
    }

    const row = employeeRowSchema.parse(data);

    return {
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
              source: "camera" as const,
              vector: row.embedding_vector,
            }
          : undefined,
      embeddings: parseEmbeddingsData(row.embeddings_data),
    };
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

  async upsertEmbeddings(employeeId: string, embeddings: FaceEmbeddings): Promise<void> {
    const client = getSupabaseClient();
    if (!client) {
      throw new Error("ยังไม่ได้ตั้งค่า Supabase");
    }

    const { error } = await client
      .from("employees")
      .update({
        embeddings_data: JSON.stringify(embeddings),
        embedding_version: embeddings.version,
        last_check_in: embeddings.updatedAt,
      })
      .eq("id", employeeId);

    if (error) {
      throw new Error(error.message);
    }
  }

  async appendEmbedding(employeeId: string, entry: FaceEmbeddingEntry): Promise<{ added: boolean; totalCount: number }> {
    const client = getSupabaseClient();
    if (!client) {
      throw new Error("ยังไม่ได้ตั้งค่า Supabase");
    }

    // First, get current embeddings
    const employee = await this.getEmployee(employeeId);
    if (!employee) {
      throw new Error("ไม่พบพนักงาน");
    }

    // Aggregate the new embedding with existing ones
    const updatedEmbeddings = aggregateEmbedding(
      employee.embeddings,
      entry,
      {
        maxEmbeddings: PROGRESSIVE_LEARNING_CONFIG.MAX_EMBEDDINGS,
        replaceThreshold: PROGRESSIVE_LEARNING_CONFIG.REPLACE_THRESHOLD,
      }
    );

    // Check if embedding was actually added/updated
    const previousCount = employee.embeddings?.entries?.length ?? 0;
    const newCount = updatedEmbeddings.entries.length;
    const added = newCount > previousCount || 
      (newCount === previousCount && previousCount > 0); // Replaced existing

    // Save updated embeddings
    await this.upsertEmbeddings(employeeId, updatedEmbeddings);

    return { added, totalCount: newCount };
  }

  async addEmployee(input: CreateEmployeeInput): Promise<Employee> {
    const client = getSupabaseClient();
    if (!client) {
      throw new Error("ยังไม่ได้ตั้งค่า Supabase");
    }

    const { data, error } = await client
      .from("employees")
      .insert({
        full_name: input.fullName,
        email: input.email,
        role: input.role,
        department: input.department,
      })
      .select()
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return {
      id: data.id,
      fullName: data.full_name,
      email: data.email,
      role: data.role,
      department: data.department ?? undefined,
      avatarUrl: data.avatar_url ?? undefined,
    };
  }

  async deleteEmployee(employeeId: string): Promise<void> {
    const client = getSupabaseClient();
    if (!client) {
      throw new Error("ยังไม่ได้ตั้งค่า Supabase");
    }

    const { error } = await client
      .from("employees")
      .delete()
      .eq("id", employeeId);

    if (error) {
      throw new Error(error.message);
    }
  }

  async clearEmbeddings(employeeId: string): Promise<void> {
    const client = getSupabaseClient();
    if (!client) {
      throw new Error("ยังไม่ได้ตั้งค่า Supabase");
    }

    const { error } = await client
      .from("employees")
      .update({
        embedding_vector: null,
        embedding_version: null,
        embeddings_data: null,
      })
      .eq("id", employeeId);

    if (error) {
      throw new Error(error.message);
    }
  }

  subscribe(callback: EmployeeChangeCallback): () => void {
    const client = getSupabaseClient();
    if (!client) {
      console.warn("Supabase not configured, real-time updates disabled");
      return () => {};
    }

    // Subscribe to changes on the employees table
    const channel = client
      .channel("employees-changes")
      .on(
        "postgres_changes",
        {
          event: "*", // Listen to all events (INSERT, UPDATE, DELETE)
          schema: "public",
          table: "employees",
        },
        async () => {
          // Re-fetch all employees when any change occurs
          try {
            const employees = await this.listEmployees();
            callback(employees);
          } catch (err) {
            console.error("Failed to fetch employees after change:", err);
          }
        }
      )
      .subscribe();

    // Return unsubscribe function
    return () => {
      client.removeChannel(channel);
    };
  }

  async listCheckInEvents(limit = 50): Promise<FaceCheckEvent[]> {
    const client = getSupabaseClient();
    if (!client) {
      throw new Error("ยังไม่ได้ตั้งค่า Supabase");
    }

    const { data, error } = await client
      .from("face_check_events")
      .select("id, employee_id, captured_at, similarity_score, is_match, snapshot, created_at")
      .order("captured_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row) => ({
      id: row.id,
      employeeId: row.employee_id,
      capturedAt: row.captured_at,
      similarityScore: row.similarity_score,
      isMatch: row.is_match,
      snapshot: row.snapshot ?? undefined,
      createdAt: row.created_at,
    }));
  }

  subscribeToCheckIns(callback: CheckInEventCallback): () => void {
    const client = getSupabaseClient();
    if (!client) {
      console.warn("Supabase not configured, real-time check-in updates disabled");
      return () => {};
    }

    // Subscribe to changes on the face_check_events table
    const channel = client
      .channel("checkin-events-changes")
      .on(
        "postgres_changes",
        {
          event: "INSERT", // Only listen to new check-ins
          schema: "public",
          table: "face_check_events",
        },
        async () => {
          // Re-fetch recent events when a new check-in occurs
          try {
            const events = await this.listCheckInEvents(50);
            callback(events);
          } catch (err) {
            console.error("Failed to fetch check-in events after change:", err);
          }
        }
      )
      .subscribe();

    // Return unsubscribe function
    return () => {
      client.removeChannel(channel);
    };
  }
}

class InMemoryEmployeeRepository implements EmployeeRepository {
  kind: EmployeeRepositoryKind = "memory";
  private employees = [...mockEmployees];

  async listEmployees(): Promise<Employee[]> {
    return [...this.employees];
  }

  async getEmployee(employeeId: string): Promise<Employee | null> {
    return this.employees.find((emp) => emp.id === employeeId) ?? null;
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
    
    // Add to check-in events
    const checkInEvent: FaceCheckEvent = {
      id: `evt_${Date.now()}`,
      employeeId: event.employeeId,
      capturedAt: event.capturedAt,
      similarityScore: event.similarityScore,
      isMatch: event.isMatch,
      snapshot: event.snapshotDataUrl,
      createdAt: new Date().toISOString(),
    };
    this.checkInEvents = [checkInEvent, ...this.checkInEvents].slice(0, 100);
    
    this.notifySubscribers();
    this.notifyCheckInSubscribers();
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
    this.notifySubscribers();
  }

  async upsertEmbeddings(employeeId: string, embeddings: FaceEmbeddings): Promise<void> {
    this.employees = this.employees.map((employee) =>
      employee.id === employeeId
        ? {
            ...employee,
            embeddings,
          }
        : employee,
    );
    this.notifySubscribers();
  }

  async appendEmbedding(employeeId: string, entry: FaceEmbeddingEntry): Promise<{ added: boolean; totalCount: number }> {
    const employee = await this.getEmployee(employeeId);
    if (!employee) {
      throw new Error("ไม่พบพนักงาน");
    }

    const updatedEmbeddings = aggregateEmbedding(
      employee.embeddings,
      entry,
      {
        maxEmbeddings: PROGRESSIVE_LEARNING_CONFIG.MAX_EMBEDDINGS,
        replaceThreshold: PROGRESSIVE_LEARNING_CONFIG.REPLACE_THRESHOLD,
      }
    );

    const previousCount = employee.embeddings?.entries?.length ?? 0;
    const newCount = updatedEmbeddings.entries.length;
    const added = newCount > previousCount || (newCount === previousCount && previousCount > 0);

    await this.upsertEmbeddings(employeeId, updatedEmbeddings);

    return { added, totalCount: newCount };
  }

  async addEmployee(input: CreateEmployeeInput): Promise<Employee> {
    const newEmployee: Employee = {
      id: `emp_${Date.now()}`,
      fullName: input.fullName,
      email: input.email,
      role: input.role,
      department: input.department,
    };
    this.employees = [...this.employees, newEmployee];
    this.notifySubscribers();
    return newEmployee;
  }

  async deleteEmployee(employeeId: string): Promise<void> {
    this.employees = this.employees.filter((emp) => emp.id !== employeeId);
    this.notifySubscribers();
  }

  async clearEmbeddings(employeeId: string): Promise<void> {
    this.employees = this.employees.map((employee) =>
      employee.id === employeeId
        ? {
            ...employee,
            embedding: undefined,
            embeddings: undefined,
          }
        : employee,
    );
    this.notifySubscribers();
  }

  private subscribers: Set<EmployeeChangeCallback> = new Set();
  private checkInSubscribers: Set<CheckInEventCallback> = new Set();
  private checkInEvents: FaceCheckEvent[] = [];

  private notifySubscribers(): void {
    this.subscribers.forEach((callback) => {
      callback([...this.employees]);
    });
  }

  private notifyCheckInSubscribers(): void {
    this.checkInSubscribers.forEach((callback) => {
      callback([...this.checkInEvents]);
    });
  }

  subscribe(callback: EmployeeChangeCallback): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  async listCheckInEvents(limit = 50): Promise<FaceCheckEvent[]> {
    return this.checkInEvents.slice(0, limit);
  }

  subscribeToCheckIns(callback: CheckInEventCallback): () => void {
    this.checkInSubscribers.add(callback);
    return () => {
      this.checkInSubscribers.delete(callback);
    };
  }
}

let cachedRepo: EmployeeRepository | null = null;

export const createEmployeeRepository = (): EmployeeRepository => {
  if (cachedRepo) return cachedRepo;
  cachedRepo = hasSupabaseConfig() ? new SupabaseEmployeeRepository() : new InMemoryEmployeeRepository();
  return cachedRepo;
};
