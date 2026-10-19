-- Deduplicate existing fraud_flags by keeping the most recent per (session_id, flag_type)
-- and add UNIQUE constraint

-- First, deduplicate: keep the row with the latest created_at for each (session_id, flag_type)
DELETE FROM fraud_flags
WHERE id NOT IN (
  SELECT DISTINCT ON (session_id, flag_type) id
  FROM fraud_flags
  ORDER BY session_id, flag_type, created_at DESC
);

-- Add the UNIQUE constraint
ALTER TABLE fraud_flags
ADD CONSTRAINT fraud_flags_session_id_flag_type_unique
UNIQUE (session_id, flag_type);
