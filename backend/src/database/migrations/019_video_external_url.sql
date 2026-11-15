-- ============================================================
-- Migration 019: Add external_url to playlist_media for YouTube embeds
-- Run once against the aiserver_db database.
-- ============================================================

-- 1. Add the external URL column (nullable – only set for embedded links)
ALTER TABLE playlist_media
    ADD COLUMN IF NOT EXISTS external_url TEXT NULL;

-- 2. Allow filename / original_name / mime_type to be NULL (external items have no physical file)
ALTER TABLE playlist_media
    ALTER COLUMN filename     DROP NOT NULL,
    ALTER COLUMN original_name DROP NOT NULL,
    ALTER COLUMN mime_type    DROP NOT NULL;

-- 3. Extend the media_type constraint to include 'youtube'
ALTER TABLE playlist_media DROP CONSTRAINT IF EXISTS playlist_media_media_type_check;
ALTER TABLE playlist_media
    ADD CONSTRAINT playlist_media_media_type_check
    CHECK (media_type = ANY (ARRAY['video'::varchar, 'pdf'::varchar, 'youtube'::varchar]));
