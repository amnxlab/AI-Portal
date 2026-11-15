-- Migration 006: Allow 'paper' as a valid type in project_files
-- Paper PDFs must be stored separately from project documents/manuals.
ALTER TABLE project_files
    DROP CONSTRAINT IF EXISTS project_files_type_check;

ALTER TABLE project_files
    ADD CONSTRAINT project_files_type_check
    CHECK (type IN ('document', 'manual', 'paper'));
