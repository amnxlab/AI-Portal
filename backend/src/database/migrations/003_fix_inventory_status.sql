-- ============================================================
-- Migration: Fix inventory item status based on quantity
-- Auto-statuses (Available / Low Stock / Out of Stock) must
-- always reflect the actual quantity on hand.
-- Manual statuses (Reserved, Checked Out, Discontinued) are
-- preserved as they represent operational states.
-- ============================================================

UPDATE inventory_items
SET status =
  CASE
    WHEN quantity = 0             THEN 'Out of Stock'
    WHEN quantity <= min_quantity THEN 'Low Stock'
    ELSE                               'Available'
  END
WHERE status IN ('Available', 'Low Stock', 'Out of Stock');
