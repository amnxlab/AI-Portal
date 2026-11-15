-- ============================================================
-- Migration 008: Extend file_folders.type to include 'document'
-- Run once against the aiserver_db database.
-- ============================================================

ALTER TABLE file_folders
    DROP CONSTRAINT IF EXISTS file_folders_type_check;

ALTER TABLE file_folders
    ADD CONSTRAINT file_folders_type_check
    CHECK (type IN ('manual', 'paper', 'document'));
