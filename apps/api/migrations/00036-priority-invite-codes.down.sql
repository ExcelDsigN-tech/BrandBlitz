DROP TABLE invite_code_redemptions;
DROP TABLE invite_codes;
DROP INDEX idx_waitlist_waiting;
ALTER TABLE waitlist DROP COLUMN activated_at, DROP COLUMN status;
