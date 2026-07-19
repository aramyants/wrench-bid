ALTER TABLE repair_sessions
  ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz;

CREATE INDEX IF NOT EXISTS repair_sessions_pending_deletion_idx
  ON repair_sessions(deletion_requested_at)
  WHERE deletion_requested_at IS NOT NULL AND deleted_at IS NULL;
