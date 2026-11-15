-- Migration 021: Attendance records table
-- Records employee clock-in/clock-out events for attendance tracking.

CREATE TABLE IF NOT EXISTS attendance_records (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action      TEXT NOT NULL CHECK (action IN ('clock_in', 'clock_out')),
  timestamp   TIMESTAMPTZ NOT NULL,
  source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'csv_import')),
  uid         VARCHAR,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attendance_user_ts ON attendance_records(user_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_attendance_ts      ON attendance_records(timestamp);
