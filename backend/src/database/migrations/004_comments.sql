-- ============================================================
-- Migration 004: Comment Threads
-- Run once against the aiserver_db database.
-- ============================================================

CREATE TABLE IF NOT EXISTS comments (
    id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type   TEXT        NOT NULL CHECK (entity_type IN ('task', 'ticket', 'project', 'video_media')),
    entity_id     UUID        NOT NULL,
    author_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content       TEXT        NOT NULL,
    mentions      JSONB       NOT NULL DEFAULT '[]',
    parent_id     UUID        REFERENCES comments(id) ON DELETE CASCADE,
    is_edited     BOOLEAN     NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast lookup by entity (the primary query pattern)
CREATE INDEX IF NOT EXISTS idx_comments_entity ON comments(entity_type, entity_id);

-- Fast lookup of replies under a parent
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id) WHERE parent_id IS NOT NULL;

-- Fast lookup of all comments by a given author
CREATE INDEX IF NOT EXISTS idx_comments_author ON comments(author_id);
