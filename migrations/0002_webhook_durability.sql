ALTER TABLE webhook_events
  ADD COLUMN IF NOT EXISTS call_id uuid REFERENCES calls(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES repair_sessions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0);

WITH matched_events AS (
  SELECT DISTINCT ON (event.id)
    event.id AS event_id,
    call.id AS call_id,
    campaign.session_id
  FROM webhook_events event
  JOIN calls call
    ON call.provider_conversation_id = (event.payload #>> '{data,conversation_id}')
    OR call.id::text = COALESCE(
      event.payload #>> '{data,conversation_initiation_client_data,dynamic_variables,wrenchbid_call_id}',
      event.payload #>> '{data,metadata,dynamic_variables,wrenchbid_call_id}',
      event.payload #>> '{data,wrenchbid_call_id}'
    )
  JOIN campaigns campaign ON campaign.id = call.campaign_id
  WHERE event.provider = 'elevenlabs'
    AND event.call_id IS NULL
  ORDER BY
    event.id,
    (call.provider_conversation_id = (event.payload #>> '{data,conversation_id}')) DESC
)
UPDATE webhook_events event
SET call_id = matched.call_id, session_id = matched.session_id
FROM matched_events matched
WHERE event.id = matched.event_id;

-- Rows that cannot be tied to a live WrenchBid call cannot be retained safely:
-- there would be no owner cascade capable of honoring a later session deletion.
DELETE FROM webhook_events
WHERE call_id IS NULL OR session_id IS NULL;

ALTER TABLE webhook_events
  ALTER COLUMN call_id SET NOT NULL,
  ALTER COLUMN session_id SET NOT NULL;

UPDATE webhook_events
SET
  processing_started_at = COALESCE(processing_started_at, received_at),
  attempt_count = GREATEST(attempt_count, 1)
WHERE status = 'received';

CREATE INDEX IF NOT EXISTS webhook_events_call_idx
  ON webhook_events(call_id)
  WHERE call_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS webhook_events_session_idx
  ON webhook_events(session_id, received_at DESC)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS webhook_events_reclaim_idx
  ON webhook_events(processing_started_at)
  WHERE status = 'received';
