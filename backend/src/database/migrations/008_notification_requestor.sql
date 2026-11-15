-- Migration 008: add requestor_id to notifications for paper read-request workflow
ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS requestor_id UUID REFERENCES users(id) ON DELETE SET NULL;
