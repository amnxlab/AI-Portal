-- Migration 020: Add employee_id field to users table
-- Used to match users against attendance records. Set by Admin only.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS employee_id VARCHAR UNIQUE;
