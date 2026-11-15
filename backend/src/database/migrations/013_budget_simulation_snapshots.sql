-- ============================================================
-- Migration 013: Budget Simulation Snapshots
-- Persists simulation scenarios to the database so they
-- survive server restarts and are accessible from any device.
-- ============================================================

CREATE TABLE IF NOT EXISTS budget_simulation_snapshots (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name           VARCHAR(255) NOT NULL,
  labor_balance  NUMERIC(15,2) NOT NULL DEFAULT 0,
  sim_months     INT NOT NULL DEFAULT 24,
  sim_start_iso  DATE NOT NULL,
  members        JSONB NOT NULL DEFAULT '[]',
  created_by_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sim_snapshots_created_by ON budget_simulation_snapshots(created_by_id);
CREATE INDEX IF NOT EXISTS idx_sim_snapshots_created_at ON budget_simulation_snapshots(created_at DESC);
