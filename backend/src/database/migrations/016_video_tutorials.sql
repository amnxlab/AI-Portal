-- ═══════════════════════════════════════════════════════════════════════════
--  016 — Video Tutorials: playlists & media
-- ═══════════════════════════════════════════════════════════════════════════

-- Playlists per project
CREATE TABLE IF NOT EXISTS video_playlists (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title       VARCHAR(255) NOT NULL,
    description TEXT,
    sort_order  INTEGER      NOT NULL DEFAULT 0,
    created_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_video_playlists_project_order
    ON video_playlists (project_id, sort_order);

-- Media items inside playlists (videos + PDFs)
CREATE TABLE IF NOT EXISTS playlist_media (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    playlist_id         UUID         NOT NULL REFERENCES video_playlists(id) ON DELETE CASCADE,
    project_id          UUID         NOT NULL REFERENCES projects(id)       ON DELETE CASCADE,
    uploader_id         UUID         REFERENCES users(id)                   ON DELETE SET NULL,
    filename            TEXT         NOT NULL,
    original_name       TEXT         NOT NULL,
    file_size           BIGINT       NOT NULL DEFAULT 0,
    mime_type           TEXT         NOT NULL,
    media_type          VARCHAR(20)  NOT NULL CHECK (media_type IN ('video', 'pdf')),
    status              VARCHAR(20)  NOT NULL DEFAULT 'pending'
                                     CHECK (status IN ('pending', 'approved', 'rejected')),
    title               VARCHAR(255) NOT NULL,
    description         TEXT,
    sort_order          INTEGER      NOT NULL DEFAULT 0,
    duration_seconds    INTEGER,
    thumbnail_filename  TEXT,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_playlist_media_playlist_order
    ON playlist_media (playlist_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_playlist_media_project_status
    ON playlist_media (project_id, status);
