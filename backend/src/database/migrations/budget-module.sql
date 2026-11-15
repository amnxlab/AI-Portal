-- ============================================================
-- Budget Management Module Migration
-- Run this script against an existing aiserver_db database
-- to add the budget module tables and migrate legacy project budgets.
-- ============================================================

-- ─── 1. Add hourly_rate to users ─────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(10,2);

-- ─── 2. Funding Sources ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS funding_sources (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  description   TEXT,
  total_amount  NUMERIC(15,2) NOT NULL DEFAULT 0,
  source_type   TEXT NOT NULL DEFAULT 'other'
                  CHECK (source_type IN ('grant','institutional','donation','external','other')),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 3. Budget Accounts ───────────────────────────────────────
-- A budget account can draw on more than one funding source, so this is a
-- many-to-many relationship (budget_account_funding_sources below) rather
-- than a single funding_source_id FK — matches
-- backend/src/budget/entities/budget-account.entity.ts.
CREATE TABLE IF NOT EXISTS budget_accounts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name              TEXT NOT NULL,
  description       TEXT,
  category          TEXT NOT NULL CHECK (category IN ('Labor','ProjectSpending')),
  total_allocated   NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS budget_account_funding_sources (
  budget_account_id UUID NOT NULL REFERENCES budget_accounts(id) ON DELETE CASCADE,
  funding_source_id UUID NOT NULL REFERENCES funding_sources(id) ON DELETE CASCADE,
  PRIMARY KEY (budget_account_id, funding_source_id)
);

-- ─── 4. Project Budget Allocations ───────────────────────────
CREATE TABLE IF NOT EXISTS project_budget_allocations (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  budget_account_id UUID NOT NULL REFERENCES budget_accounts(id) ON DELETE CASCADE,
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  allocated_amount  NUMERIC(15,2) NOT NULL,
  notes             TEXT,
  created_by_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 5. Budget Transfers ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS budget_transfers (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_account_id    UUID REFERENCES budget_accounts(id) ON DELETE SET NULL,
  to_account_id      UUID REFERENCES budget_accounts(id) ON DELETE SET NULL,
  from_allocation_id UUID REFERENCES project_budget_allocations(id) ON DELETE SET NULL,
  to_allocation_id   UUID REFERENCES project_budget_allocations(id) ON DELETE SET NULL,
  transfer_type      TEXT NOT NULL
                       CHECK (transfer_type IN
                         ('account_to_account','project_to_project','account_to_project','project_to_account')),
  amount             NUMERIC(15,2) NOT NULL,
  reason             TEXT NOT NULL,
  performed_by_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 6. Expenses ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expenses (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  allocation_id   UUID NOT NULL REFERENCES project_budget_allocations(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  description     TEXT NOT NULL,
  amount          NUMERIC(15,2) NOT NULL,
  category        TEXT NOT NULL DEFAULT 'other'
                    CHECK (category IN ('equipment','supplies','travel','other')),
  vendor          TEXT,
  receipt_url     TEXT,
  expense_date    DATE NOT NULL,
  recorded_by_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  wishlist_item_id UUID,  -- soft link, no FK constraint
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 7. Labor Deductions ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS labor_deductions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  weekly_report_id  UUID REFERENCES weekly_reports(id) ON DELETE SET NULL,
  user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  budget_account_id UUID NOT NULL REFERENCES budget_accounts(id) ON DELETE CASCADE,
  hours             NUMERIC(8,2) NOT NULL,
  hourly_rate       NUMERIC(10,2) NOT NULL,
  amount            NUMERIC(15,2) NOT NULL,
  week_start        DATE NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(weekly_report_id, budget_account_id)
);

-- ─── 8. Indexes ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_budget_accounts_source   ON budget_accounts(funding_source_id);
CREATE INDEX IF NOT EXISTS idx_allocations_project      ON project_budget_allocations(project_id);
CREATE INDEX IF NOT EXISTS idx_allocations_account      ON project_budget_allocations(budget_account_id);
CREATE INDEX IF NOT EXISTS idx_expenses_project         ON expenses(project_id);
CREATE INDEX IF NOT EXISTS idx_expenses_allocation      ON expenses(allocation_id);
CREATE INDEX IF NOT EXISTS idx_labor_deductions_account ON labor_deductions(budget_account_id);
CREATE INDEX IF NOT EXISTS idx_labor_deductions_user    ON labor_deductions(user_id);
CREATE INDEX IF NOT EXISTS idx_transfers_from_account   ON budget_transfers(from_account_id);
CREATE INDEX IF NOT EXISTS idx_transfers_to_account     ON budget_transfers(to_account_id);

-- ─── 9. Migrate legacy project budgets ───────────────────────
-- Creates one "Migrated Legacy Budgets" funding source and one
-- ProjectSpending account per project that had budget > 0.
DO $$
DECLARE
  v_source_id UUID;
  v_account_id UUID;
  r RECORD;
BEGIN
  -- Only migrate if there are any non-zero budgets
  IF EXISTS (SELECT 1 FROM projects WHERE budget > 0) THEN
    -- Create the legacy funding source (idempotent)
    SELECT id INTO v_source_id FROM funding_sources WHERE name = 'Migrated Legacy Budgets' LIMIT 1;
    IF v_source_id IS NULL THEN
      INSERT INTO funding_sources (name, description, total_amount, source_type, is_active)
      VALUES (
        'Migrated Legacy Budgets',
        'Automatically created from existing project budget fields during the budget module migration.',
        (SELECT COALESCE(SUM(budget), 0) FROM projects WHERE budget > 0),
        'institutional',
        true
      )
      RETURNING id INTO v_source_id;
    END IF;

    -- Create one ProjectSpending account and allocation per project with budget > 0
    FOR r IN SELECT id, name, budget FROM projects WHERE budget > 0 LOOP
      -- Check if already migrated
      IF NOT EXISTS (
        SELECT 1 FROM project_budget_allocations pba
        JOIN budget_accounts ba ON ba.id = pba.budget_account_id
        WHERE pba.project_id = r.id AND ba.funding_source_id = v_source_id
      ) THEN
        INSERT INTO budget_accounts (funding_source_id, name, description, category, total_allocated)
        VALUES (
          v_source_id,
          r.name || ' — Project Budget',
          'Migrated from legacy project budget field',
          'ProjectSpending',
          r.budget
        )
        RETURNING id INTO v_account_id;

        INSERT INTO project_budget_allocations (budget_account_id, project_id, allocated_amount, notes)
        VALUES (
          v_account_id,
          r.id,
          r.budget,
          'Migrated from legacy project.budget field'
        );
      END IF;
    END LOOP;
  END IF;
END $$;

-- ─── 10. Remove legacy budget column from projects ────────────
-- (Commented out by default – uncomment only after verifying migration)
-- ALTER TABLE projects DROP COLUMN IF EXISTS budget;
