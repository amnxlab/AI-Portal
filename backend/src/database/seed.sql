-- ============================================================
-- AI-Server - Seed Data
-- admin       / Admin1234!
-- employee1   / Employee1!
-- inv_manager / Admin1234!
-- ============================================================

-- ─── ROLES ────────────────────────────────────────────────────
-- Single unified role. Access is configured per user (users.permissions).
INSERT INTO roles (name, label, color, is_system, permissions) VALUES
(
  'Member', 'Lab Member', '#58a6ff', true,
  '{"manage_users":false,"manage_inventory":false,"manage_projects":false,"lead_projects":false,"manage_tasks":false,"manage_schedules":false,"manage_reports":false,"manage_wishlists":true,"view_team_data":false,"post_discord":false,"cap_hours":false,"view_all_schedules":false,"manage_budget":false,"manage_attendance":false}'
)
ON CONFLICT (name) DO NOTHING;

INSERT INTO users (username, email, full_name, password_hash, role, permissions)
VALUES (
  'admin',
  'admin@lab.local',
  'System Admin',
  '$2b$12$VaRNh3vfAvPprpJzmf0DQeu6V148AcLJ3kxPDbxZMrTbrV/mYdJKC',
  'Member',
  '{"manage_users":true,"manage_inventory":true,"manage_projects":true,"lead_projects":true,"manage_tasks":true,"manage_schedules":true,"manage_reports":true,"manage_wishlists":true,"view_team_data":true,"post_discord":true,"cap_hours":true,"view_all_schedules":true,"manage_budget":true,"manage_attendance":true}'
) ON CONFLICT (username) DO NOTHING;

-- Sample employee (password: Employee1!)
INSERT INTO users (username, email, full_name, password_hash, role, permissions)
VALUES (
  'employee1',
  'employee1@lab.local',
  'Alice Researcher',
  '$2b$12$VaRNh3vfAvPprpJzmf0DQeu6V148AcLJ3kxPDbxZMrTbrV/mYdJKC',
  'Member',
  '{"manage_wishlists":true}'
) ON CONFLICT (username) DO NOTHING;

-- Sample Inventory Manager (password: Admin1234!)
INSERT INTO users (username, email, full_name, password_hash, role, permissions)
VALUES (
  'inv_manager',
  'inventory@lab.local',
  'Bob Inventory',
  '$2b$12$VaRNh3vfAvPprpJzmf0DQeu6V148AcLJ3kxPDbxZMrTbrV/mYdJKC',
  'Member',
  '{"manage_inventory":true,"manage_wishlists":true,"view_team_data":true}'
) ON CONFLICT (username) DO NOTHING;

-- Sample Project + Tasks
INSERT INTO projects (name, description, status, start_date, end_date, budget)
VALUES (
  'Lab Automation System',
  'Automating daily lab workflows using embedded sensors and ML',
  'Active',
  '2026-03-01',
  '2026-06-30',
  15000.00
) ON CONFLICT DO NOTHING;

-- ─── INVENTORY CATEGORIES ─────────────────────────────────────
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
