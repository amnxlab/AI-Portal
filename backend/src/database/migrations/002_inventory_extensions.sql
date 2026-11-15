-- ============================================================
-- Migration: Inventory Extensions
-- Adds: code, sub_location, extra_info, condition, assigned_to
-- Updates: status CHECK, inventory_logs action CHECK
-- ============================================================

-- ─── New columns on inventory_items ───────────────────────────
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS code         TEXT;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS sub_location TEXT;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS extra_info   TEXT;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS condition    TEXT DEFAULT 'Unknown';
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS assigned_to  UUID REFERENCES users(id) ON DELETE SET NULL;

-- ─── Update status CHECK to include 'Checked Out' & 'Reserved' ─
ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS inventory_items_status_check;
ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_status_check
  CHECK (status IN ('Available','Low Stock','Out of Stock','Discontinued','Reserved','Checked Out'));

-- ─── Add condition CHECK ──────────────────────────────────────
ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS inventory_items_condition_check;
ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_condition_check
  CHECK (condition IN ('Good','Alright','Unknown','Damaged','New'));

-- ─── Update inventory_logs action CHECK to include 'assign' & 'unassign' ─
ALTER TABLE inventory_logs DROP CONSTRAINT IF EXISTS inventory_logs_action_check;
ALTER TABLE inventory_logs ADD CONSTRAINT inventory_logs_action_check
  CHECK (action IN ('check_in','check_out','add','edit','delete','assign','unassign'));

-- ─── New indexes ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_inventory_code        ON inventory_items(code);
CREATE INDEX IF NOT EXISTS idx_inventory_assigned_to ON inventory_items(assigned_to);

-- ─── Predefined inventory categories ──────────────────────────
CREATE TABLE IF NOT EXISTS inventory_categories (
  id    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code  TEXT NOT NULL UNIQUE,
  name  TEXT NOT NULL UNIQUE
);

INSERT INTO inventory_categories (code, name) VALUES
  ('ELC', 'Electronics'),
  ('CPH', 'Computing Hardware'),
  ('ORG', 'Organization'),
  ('TLS', 'Tools'),
  ('SEN', 'Sensors'),
  ('CAB', 'Cables/Adaptors'),
  ('MAC', 'Machineary'),
  ('MIS', 'Miscellanous'),
  ('RBT', 'Robotics'),
  ('DEV', 'Devices')
ON CONFLICT (code) DO NOTHING;
