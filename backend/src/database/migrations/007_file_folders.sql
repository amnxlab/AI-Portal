-- ============================================================
-- Migration 007: Folder-Based Classification for Manuals & Papers
-- Run once against the aiserver_db database.
-- ============================================================

-- ── File folders (shared by manuals and papers) ─────────────
CREATE TABLE IF NOT EXISTS file_folders (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID         NOT NULL REFERENCES projects(id)     ON DELETE CASCADE,
    parent_id   UUID                  REFERENCES file_folders(id) ON DELETE SET NULL,
    type        VARCHAR(20)  NOT NULL CHECK (type IN ('manual', 'paper')),
    name        VARCHAR(255) NOT NULL,
    created_by  UUID                  REFERENCES users(id)        ON DELETE SET NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_file_folders_project_type_parent
    ON file_folders(project_id, type, parent_id);

CREATE INDEX IF NOT EXISTS idx_file_folders_parent
    ON file_folders(parent_id) WHERE parent_id IS NOT NULL;

-- ── Add folder references to existing tables ────────────────
ALTER TABLE project_files
    ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES file_folders(id) ON DELETE SET NULL;

ALTER TABLE papers
    ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES file_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_project_files_folder
    ON project_files(folder_id) WHERE folder_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_papers_folder
    ON papers(folder_id) WHERE folder_id IS NOT NULL;
