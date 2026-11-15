-- ============================================================
-- 023 — Unified Member role + per-user permissions
-- ============================================================
-- Replaces the role-name access model with ONE system role ('Member') and a
-- modular per-user permission set stored in users.permissions.
--
-- RolesService.onModuleInit() performs the same migration at boot, so this
-- file is for manual/offline application and for fresh reference. It is
-- idempotent and safe to run more than once.
-- ============================================================

BEGIN;

-- ── 1. Schema ────────────────────────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS permissions JSONB;

ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS replaced_by_hash VARCHAR;

-- ── 2. Backfill each user's permission set from their legacy role ────────────
-- Only users without a personal permission set are touched, so re-running
-- never overwrites permissions an administrator configured later.
UPDATE users u
SET permissions = CASE u.role
    WHEN 'Admin' THEN '{
        "manage_users":true,"manage_inventory":true,"manage_projects":true,
        "lead_projects":true,"manage_tasks":true,"manage_schedules":true,
        "manage_reports":true,"manage_wishlists":true,"view_team_data":true,
        "post_discord":true,"cap_hours":true,"view_all_schedules":true,
        "manage_budget":true,"manage_attendance":true
    }'::jsonb
    WHEN 'Project_Leader' THEN '{
        "manage_users":false,"manage_inventory":false,"manage_projects":false,
        "lead_projects":true,"manage_tasks":true,"manage_schedules":false,
        "manage_reports":false,"manage_wishlists":true,"view_team_data":true,
        "post_discord":false,"cap_hours":false,"view_all_schedules":false,
        "manage_budget":false,"manage_attendance":false
    }'::jsonb
    WHEN 'Inventory_Manager' THEN '{
        "manage_users":false,"manage_inventory":true,"manage_projects":false,
        "lead_projects":false,"manage_tasks":false,"manage_schedules":false,
        "manage_reports":false,"manage_wishlists":true,"view_team_data":true,
        "post_discord":false,"cap_hours":false,"view_all_schedules":false,
        "manage_budget":false,"manage_attendance":false
    }'::jsonb
    -- 'Manager' is an older role name kept for pre-2026 databases
    WHEN 'Manager' THEN '{
        "manage_users":false,"manage_inventory":false,"manage_projects":true,
        "lead_projects":false,"manage_tasks":true,"manage_schedules":true,
        "manage_reports":true,"manage_wishlists":true,"view_team_data":true,
        "post_discord":true,"cap_hours":false,"view_all_schedules":false,
        "manage_budget":false,"manage_attendance":false
    }'::jsonb
    -- Lab_Assistant, Employee, Member, unknown → member baseline
    ELSE '{"manage_wishlists":true}'::jsonb
END
WHERE u.permissions IS NULL;

-- Ensure every flag exists for users that already had a partial set.
UPDATE users
SET permissions = '{
    "manage_users":false,"manage_inventory":false,"manage_projects":false,
    "lead_projects":false,"manage_tasks":false,"manage_schedules":false,
    "manage_reports":false,"manage_wishlists":true,"view_team_data":false,
    "post_discord":false,"cap_hours":false,"view_all_schedules":false,
    "manage_budget":false,"manage_attendance":false
}'::jsonb || permissions
WHERE permissions IS NOT NULL;

-- Make the column non-nullable now that everyone has a value.
ALTER TABLE users
  ALTER COLUMN permissions SET DEFAULT '{"manage_wishlists":true}'::jsonb,
  ALTER COLUMN permissions SET NOT NULL;

-- ── 3. Collapse everyone onto the single unified role ───────────────────────
UPDATE users
SET role = 'Member'
WHERE role IS DISTINCT FROM 'Member';

ALTER TABLE users
  ALTER COLUMN role SET DEFAULT 'Member';

-- ── 4. Replace every role row with the single system role ───────────────────
INSERT INTO roles (name, label, color, is_system, permissions)
VALUES (
    'Member', 'Lab Member', '#58a6ff', true,
    '{
        "manage_users":false,"manage_inventory":false,"manage_projects":false,
        "lead_projects":false,"manage_tasks":false,"manage_schedules":false,
        "manage_reports":false,"manage_wishlists":true,"view_team_data":false,
        "post_discord":false,"cap_hours":false,"view_all_schedules":false,
        "manage_budget":false,"manage_attendance":false
    }'::jsonb
)
ON CONFLICT (name) DO UPDATE
SET label = EXCLUDED.label,
    color = EXCLUDED.color,
    is_system = true;

DELETE FROM roles WHERE name <> 'Member';

COMMIT;
