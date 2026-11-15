-- Migration 011: Add wishlist source tracking to inventory_items
-- Allows tracing which inventory item was purchased from a wishlist entry

ALTER TABLE inventory_items
    ADD COLUMN IF NOT EXISTS source_wishlist_item_id UUID REFERENCES wishlist_items(id) ON DELETE SET NULL;

ALTER TABLE inventory_items
    ADD COLUMN IF NOT EXISTS source_wishlist_note TEXT;
