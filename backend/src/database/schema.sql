-- ============================================================
-- AI-Server Lab Management Platform - Database Schema
-- PostgreSQL 15
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── ROLES ────────────────────────────────────────────────────
CREATE TABLE roles (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#58a6ff',
  is_system   BOOLEAN NOT NULL DEFAULT false,
  permissions JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── USERS & AUTH ─────────────────────────────────────────────
CREATE TABLE users (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username         TEXT NOT NULL UNIQUE,
  email            TEXT UNIQUE,
  full_name        TEXT NOT NULL,
  password_hash    TEXT NOT NULL,
  -- Unified role model: everyone is a 'Member'. Access is driven by the
  -- per-user `permissions` object below, never by the role name.
  role             TEXT NOT NULL DEFAULT 'Member',
  permissions      JSONB NOT NULL DEFAULT '{"manage_wishlists": true}',
  is_active        BOOLEAN NOT NULL DEFAULT true,
  avatar_url       TEXT,
  bio              TEXT,
  job_title        TEXT,
  weekly_hours_cap INTEGER,
  hourly_rate      NUMERIC(10,2) DEFAULT 15.00,
  remote_work_restricted BOOLEAN NOT NULL DEFAULT false,
  is_on_hold       BOOLEAN NOT NULL DEFAULT false,
  employee_id      VARCHAR UNIQUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  -- Rotation bookkeeping: set when this token is exchanged for a newer one.
  -- A short reuse-grace window tolerates concurrent refreshes (multi-tab) and
  -- prevents the former race that logged users out at random.
  rotated_at      TIMESTAMPTZ,
  replaced_by_hash VARCHAR,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE password_reset_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── SCHEDULING ───────────────────────────────────────────────
CREATE TABLE schedules (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start      DATE NOT NULL,
  shifts          JSONB NOT NULL DEFAULT '[]',
  notes           TEXT,
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  discord_posted  BOOLEAN NOT NULL DEFAULT false,
  status          TEXT NOT NULL DEFAULT 'Submitted',
  review_note     TEXT,
  reviewed_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ,
  UNIQUE(user_id, week_start)
);
CREATE INDEX idx_schedules_week ON schedules(week_start);
CREATE INDEX idx_schedules_user ON schedules(user_id);

-- ─── INVENTORY ────────────────────────────────────────────────
CREATE TABLE inventory_items (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         TEXT NOT NULL,
  category     TEXT,
  description  TEXT,
  quantity     INTEGER NOT NULL DEFAULT 0,
  unit         TEXT NOT NULL DEFAULT 'pcs',
  status       TEXT NOT NULL DEFAULT 'Available' CHECK (status IN ('Available','Low Stock','Out of Stock','Discontinued','Reserved','Checked Out')),
  location     TEXT,
  photo_url    TEXT,
  min_quantity INTEGER NOT NULL DEFAULT 0,
  code         TEXT,
  sub_location TEXT,
  extra_info   TEXT,
  condition    TEXT DEFAULT 'Unknown' CHECK (condition IN ('Good','Alright','Unknown','Damaged','New')),
  assigned_to  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_inventory_category    ON inventory_items(category);
CREATE INDEX idx_inventory_status      ON inventory_items(status);
CREATE INDEX idx_inventory_code        ON inventory_items(code);
CREATE INDEX idx_inventory_assigned_to ON inventory_items(assigned_to);

CREATE TABLE inventory_logs (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id        UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  action         TEXT NOT NULL CHECK (action IN ('check_in','check_out','add','edit','delete','assign','unassign')),
  quantity_delta INTEGER,
  notes          TEXT,
  logged_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_inventory_logs_item ON inventory_logs(item_id);

-- ─── INVENTORY CATEGORIES ─────────────────────────────────────
CREATE TABLE inventory_categories (
  id    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code  TEXT NOT NULL UNIQUE,
  name  TEXT NOT NULL UNIQUE
);

-- ─── PROJECTS & TASKS ─────────────────────────────────────────
CREATE TABLE projects (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','On Hold','Planned','Completed','Cancelled')),
  start_date  DATE,
  end_date    DATE,
  budget      NUMERIC(12,2) DEFAULT 0,
  owner_id    UUID REFERENCES users(id),
  cover_image VARCHAR,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sub_projects (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Completed', 'On Hold', 'Planned')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE project_members (
  id         UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    UUID    NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  is_leader  BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);
CREATE INDEX idx_project_members_project ON project_members(project_id);
CREATE INDEX idx_project_members_user    ON project_members(user_id);

CREATE TABLE tasks (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sub_project_id   UUID REFERENCES sub_projects(id) ON DELETE SET NULL,
  assignee_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by       UUID REFERENCES users(id),
  title            TEXT NOT NULL,
  description      TEXT,
  status           TEXT NOT NULL DEFAULT 'Todo' CHECK (status IN ('Todo','In Progress','Done','Blocked','Pending Review','Needs Revision')),
  priority         TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low','Medium','High','Critical')),
  deadline         DATE,
  estimated_hours  NUMERIC(6,2),
  actual_hours     NUMERIC(6,2),
  position         INTEGER NOT NULL DEFAULT 0,
  attachments      JSONB NOT NULL DEFAULT '[]',
  discord_notified BOOLEAN NOT NULL DEFAULT false,
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  paused_at        TIMESTAMPTZ,
  total_paused_ms  BIGINT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tasks_assignee  ON tasks(assignee_id);
CREATE INDEX idx_tasks_project   ON tasks(project_id);
CREATE INDEX idx_tasks_status    ON tasks(status);
CREATE INDEX idx_tasks_deadline  ON tasks(deadline);

-- ─── WISHLISTS ────────────────────────────────────────────────
CREATE TABLE wishlist_items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id      UUID REFERENCES projects(id) ON DELETE CASCADE,
  sub_project_id  UUID REFERENCES sub_projects(id) ON DELETE SET NULL,
  item_name       TEXT NOT NULL,
  description     TEXT,
  cost            NUMERIC(10,2) NOT NULL DEFAULT 0,
  link            TEXT,
  status          TEXT NOT NULL DEFAULT 'Requested' CHECK (status IN ('Requested','Approved','Purchased','Rejected')),
  requested_by    UUID REFERENCES users(id),
  approved_by     UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_wishlist_project ON wishlist_items(project_id);
CREATE INDEX idx_wishlist_status  ON wishlist_items(status);

-- ─── WEEKLY REPORTS ───────────────────────────────────────────
CREATE TABLE weekly_reports (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start      DATE NOT NULL,
  tasks_hours     JSONB NOT NULL DEFAULT '[]',
  total_hours     NUMERIC(6,2) NOT NULL DEFAULT 0,
  remote_hours    NUMERIC(6,2) NOT NULL DEFAULT 0,
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Submitted','Approved','Needs Revision')),
  submitted_at    TIMESTAMPTZ,
  review_note     TEXT,
  reviewed_by     UUID,
  reviewed_at     TIMESTAMPTZ,
  manager_comment TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, week_start)
);
CREATE INDEX idx_reports_user_week ON weekly_reports(user_id, week_start);
CREATE INDEX idx_reports_week      ON weekly_reports(week_start);

-- ─── AUDIT TRAIL ──────────────────────────────────────────────
CREATE TABLE audit_logs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  entity_type  TEXT NOT NULL,
  entity_id    UUID,
  action       TEXT NOT NULL,
  old_value    JSONB,
  new_value    JSONB,
  ip_address   TEXT,
  timestamp    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity    ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_actor     ON audit_logs(actor_id);
CREATE INDEX idx_audit_timestamp ON audit_logs(timestamp);

-- ─── PROJECT FILES (documents & manuals) ──────────────────────
CREATE TABLE project_files (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  uploader_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  filename      TEXT NOT NULL,
  original_name TEXT NOT NULL,
  file_size     BIGINT NOT NULL DEFAULT 0,
  mime_type     TEXT,
  type          TEXT NOT NULL DEFAULT 'document' CHECK (type IN ('document','manual','paper')),
  status        TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending','approved','rejected')),
  category      TEXT,
  title         TEXT,
  description   TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_project_files_project ON project_files(project_id);
CREATE INDEX idx_project_files_type    ON project_files(project_id, type);

-- ── Support tickets ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tickets (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  submitter_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('bug','access_request')),
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  screenshot_url  TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  resolution_note TEXT,
  resolved_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tickets_submitter ON tickets(submitter_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status    ON tickets(status);

-- ─── ATTENDANCE ───────────────────────────────────────────────
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
