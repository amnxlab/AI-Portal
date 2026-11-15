-- Migration 014: Add remote_work_restricted to users
-- When enabled by an Admin, the user cannot log any remote hours.
-- All submitted weekly report hours must be on-site.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS remote_work_restricted BOOLEAN NOT NULL DEFAULT false;
