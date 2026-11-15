-- Migration 012: Add weekly_hours_cap_snapshot to weekly_reports
-- Captures the user's hourly cap at the time of submission so that
-- approved reports remain unaffected by later policy changes.

ALTER TABLE weekly_reports
    ADD COLUMN IF NOT EXISTS weekly_hours_cap_snapshot NUMERIC(5,1);
