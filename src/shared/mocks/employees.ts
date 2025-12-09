import type { Employee } from "@/entities/employee";

// Mock employees without pre-enrolled faces
// Use the Dev Tools to register faces with face-api.js
export const mockEmployees: Employee[] = [
  {
    id: "emp_jen",
    fullName: "Jenna Kim",
    role: "People Operations",
    email: "jenna.kim@example.com",
    department: "HR",
    avatarUrl: "https://api.dicebear.com/9.x/initials/svg?seed=JK",
    lastCheckIn: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    // No embedding - needs to be enrolled with face-api.js
  },
  {
    id: "emp_omar",
    fullName: "Omar Singh",
    role: "Security Lead",
    email: "omar.singh@example.com",
    department: "Security",
    avatarUrl: "https://api.dicebear.com/9.x/initials/svg?seed=OS",
    lastCheckIn: new Date(Date.now() - 1000 * 60 * 130).toISOString(),
    // No embedding - needs to be enrolled with face-api.js
  },
  {
    id: "emp_ami",
    fullName: "Amisha Patel",
    role: "Data Specialist",
    email: "amisha.patel@example.com",
    department: "Insights",
    avatarUrl: "https://api.dicebear.com/9.x/initials/svg?seed=AP",
    lastCheckIn: new Date(Date.now() - 1000 * 60 * 720).toISOString(),
    // No embedding - needs to be enrolled with face-api.js
  },
];
