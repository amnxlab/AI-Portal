-- Migration 010: Add status column to sub_projects
-- The sub_projects table was missing the status column
-- that exists in schema.sql and the SubProject entity.

ALTER TABLE sub_projects
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Active'
        CHECK (status IN ('Active', 'Completed', 'On Hold', 'Planned'));
