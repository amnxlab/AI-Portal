-- ============================================================
-- Migration 005: Research Module — Phase 1 (Literature)
-- Run once against the aiserver_db database.
-- ============================================================

-- ── Papers (literature references) ─────────────────────────
CREATE TABLE IF NOT EXISTS papers (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title       VARCHAR(500) NOT NULL,
    authors     TEXT,
    year        INTEGER,
    venue       VARCHAR(255),
    doi         VARCHAR(255),
    url         TEXT,
    abstract    TEXT,
    notes       TEXT,
    tags        JSONB       NOT NULL DEFAULT '[]',
    added_by    UUID        REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_papers_project   ON papers(project_id);
CREATE INDEX IF NOT EXISTS idx_papers_doi       ON papers(doi) WHERE doi IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_papers_tags      ON papers USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_papers_added_by  ON papers(added_by);

-- ── Paper–File links (attach PDFs / supplementary to papers) ─
CREATE TABLE IF NOT EXISTS paper_files (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    paper_id    UUID        NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    file_id     UUID        REFERENCES project_files(id) ON DELETE SET NULL,
    file_type   VARCHAR(30) NOT NULL DEFAULT 'pdf'
                CHECK (file_type IN ('pdf', 'supplementary', 'slides', 'poster', 'code')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_paper_files_paper ON paper_files(paper_id);
CREATE INDEX IF NOT EXISTS idx_paper_files_file  ON paper_files(file_id) WHERE file_id IS NOT NULL;
