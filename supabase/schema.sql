-- PDE Check-in Database Schema
-- Run this SQL in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Employees table
CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'Employee',
  department TEXT,
  avatar_url TEXT,
  last_check_in TIMESTAMPTZ,
  
  -- Legacy single embedding (backward compatible)
  embedding_version TEXT,
  embedding_vector DOUBLE PRECISION[],
  
  -- New multi-embedding format (JSON)
  embeddings_data JSONB,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Face check events table (check-in logs)
CREATE TABLE IF NOT EXISTS face_check_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  captured_at TIMESTAMPTZ NOT NULL,
  similarity_score DOUBLE PRECISION NOT NULL,
  is_match BOOLEAN NOT NULL DEFAULT false,
  snapshot TEXT, -- Base64 image data
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_employees_email ON employees(email);
CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department);
CREATE INDEX IF NOT EXISTS idx_face_check_events_employee ON face_check_events(employee_id);
CREATE INDEX IF NOT EXISTS idx_face_check_events_captured_at ON face_check_events(captured_at DESC);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for employees updated_at
DROP TRIGGER IF EXISTS update_employees_updated_at ON employees;
CREATE TRIGGER update_employees_updated_at
  BEFORE UPDATE ON employees
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS) Policies
-- Enable RLS
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE face_check_events ENABLE ROW LEVEL SECURITY;

-- Allow public read/write for now (adjust based on your auth requirements)
CREATE POLICY "Allow public read employees" ON employees
  FOR SELECT USING (true);

CREATE POLICY "Allow public insert employees" ON employees
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public update employees" ON employees
  FOR UPDATE USING (true);

CREATE POLICY "Allow public delete employees" ON employees
  FOR DELETE USING (true);

CREATE POLICY "Allow public read face_check_events" ON face_check_events
  FOR SELECT USING (true);

CREATE POLICY "Allow public insert face_check_events" ON face_check_events
  FOR INSERT WITH CHECK (true);

-- Sample employee data (optional - comment out if not needed)
-- INSERT INTO employees (full_name, email, role, department) VALUES
--   ('Jenna Kim', 'jenna.kim@example.com', 'People Operations', 'HR'),
--   ('Omar Singh', 'omar.singh@example.com', 'Security Lead', 'Security'),
--   ('Amisha Patel', 'amisha.patel@example.com', 'Data Specialist', 'Insights');

