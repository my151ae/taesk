-- Add support for multiple assignees per card
-- New column: assignee_ids (UUID array)
-- Keep assignee_id for backward compatibility

ALTER TABLE cards
  ADD COLUMN IF NOT EXISTS assignee_ids UUID[] DEFAULT '{}';

-- Migrate existing assignee_id to assignee_ids
UPDATE cards
SET assignee_ids = ARRAY[assignee_id]
WHERE assignee_id IS NOT NULL AND assignee_ids = '{}';

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_cards_assignee_ids ON cards USING GIN(assignee_ids);

COMMENT ON COLUMN cards.assignee_ids IS 'Array of user IDs assigned to this card. Supports multiple assignees.';
