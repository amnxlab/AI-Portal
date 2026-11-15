-- ============================================================
-- Migration 018: Extend comments.entity_type to allow video_media
-- Run once against the aiserver_db database.
-- ============================================================

ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_entity_type_check;
ALTER TABLE comments ADD CONSTRAINT comments_entity_type_check
    CHECK (entity_type = ANY (ARRAY['task', 'ticket', 'project', 'video_media']));
