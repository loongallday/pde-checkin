import type { Employee, FaceEmbedding } from "@/entities/employee";

const buildVector = (seed: number): number[] => {
  return Array.from({ length: 256 }, (_, idx) => {
    const value = Math.sin(seed * (idx + 1)) + Math.cos((seed + 1) * (idx + 1));
    return Number(((value + 2) / 4).toFixed(4));
  });
};

const createEmbedding = (seed: number): FaceEmbedding => ({
  version: "simple-v1",
  createdAt: new Date(Date.now() - seed * 1000 * 60).toISOString(),
  source: "camera",
  vector: buildVector(seed),
});

export const mockEmployees: Employee[] = [
  {
    id: "emp_jen",
    fullName: "Jenna Kim",
    role: "People Operations",
    email: "jenna.kim@example.com",
    department: "HR",
    avatarUrl: "https://api.dicebear.com/9.x/initials/svg?seed=JK",
    lastCheckIn: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    embedding: createEmbedding(42),
  },
  {
    id: "emp_omar",
    fullName: "Omar Singh",
    role: "Security Lead",
    email: "omar.singh@example.com",
    department: "Security",
    avatarUrl: "https://api.dicebear.com/9.x/initials/svg?seed=OS",
    lastCheckIn: new Date(Date.now() - 1000 * 60 * 130).toISOString(),
    embedding: createEmbedding(77),
  },
  {
    id: "emp_ami",
    fullName: "Amisha Patel",
    role: "Data Specialist",
    email: "amisha.patel@example.com",
    department: "Insights",
    avatarUrl: "https://api.dicebear.com/9.x/initials/svg?seed=AP",
    lastCheckIn: new Date(Date.now() - 1000 * 60 * 720).toISOString(),
    embedding: createEmbedding(13),
  },
];
