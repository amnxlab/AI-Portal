-- Migration 007: Link reading tasks back to their source paper
ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS paper_id UUID REFERENCES papers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_paper_id ON tasks(paper_id);
