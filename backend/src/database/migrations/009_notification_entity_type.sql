-- Migration 009: add entity_type to notifications for mention routing
ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS entity_type VARCHAR(50);
