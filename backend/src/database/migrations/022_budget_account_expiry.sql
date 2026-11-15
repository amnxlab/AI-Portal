-- Migration 022: Add expires_at to budget_accounts
-- When set and in the past, the account is treated as expired: no new
-- expenses, allocations, labor deductions, or transfers (in either
-- direction) may be recorded against it. Historical records remain
-- visible for reporting.

ALTER TABLE budget_accounts
    ADD COLUMN IF NOT EXISTS expires_at DATE NULL;
