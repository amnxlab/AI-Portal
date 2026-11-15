-- Migration 017: Add is_on_hold to users
-- When enabled by an Admin, the user account is placed on hold:
-- the user can still log in and view all data they have access to,
-- but cannot submit or modify anything (all write operations are blocked).

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_on_hold BOOLEAN NOT NULL DEFAULT false;
