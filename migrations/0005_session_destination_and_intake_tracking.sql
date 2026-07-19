ALTER TABLE session_shops
  ADD COLUMN IF NOT EXISTS verified_phone text,
  ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS phone_verification_method text;

UPDATE session_shops selection
SET
  verified_phone = shop.phone,
  phone_verified_at = shop.phone_verified_at,
  phone_verification_method = shop.phone_verification_method
FROM shops shop
WHERE shop.id = selection.shop_id
  AND shop.phone_verified IS TRUE
  AND shop.phone ~ '^[+][1-9][0-9]{7,14}$'
  AND selection.verified_phone IS NULL;

ALTER TABLE session_shops
  DROP CONSTRAINT IF EXISTS session_shops_verified_phone_format;

ALTER TABLE session_shops
  ADD CONSTRAINT session_shops_verified_phone_format CHECK (
    verified_phone IS NULL OR verified_phone ~ '^[+][1-9][0-9]{7,14}$'
  );

ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS destination_phone text;

UPDATE calls call
SET destination_phone = selection.verified_phone
FROM campaigns campaign
JOIN session_shops selection ON selection.session_id = campaign.session_id
WHERE call.campaign_id = campaign.id
  AND selection.shop_id = call.shop_id
  AND call.destination_phone IS NULL;

ALTER TABLE calls
  DROP CONSTRAINT IF EXISTS calls_destination_phone_format;

ALTER TABLE calls
  ADD CONSTRAINT calls_destination_phone_format CHECK (
    destination_phone IS NULL OR destination_phone ~ '^[+][1-9][0-9]{7,14}$'
  );

CREATE TABLE IF NOT EXISTS intake_conversations (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES repair_sessions(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'elevenlabs',
  provider_conversation_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS intake_conversations_session_idx
  ON intake_conversations(session_id, created_at);

-- A call-initiation failure can arrive before the outbound API response stores the
-- conversation ID. ElevenLabs does not retry this event type, so retain only the
-- minimal non-transcript failure data briefly and reconcile it when dispatch returns.
CREATE TABLE IF NOT EXISTS pending_provider_failures (
  provider text NOT NULL,
  provider_conversation_id text NOT NULL,
  failure_reason text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  PRIMARY KEY (provider, provider_conversation_id)
);

CREATE INDEX IF NOT EXISTS pending_provider_failures_expiry_idx
  ON pending_provider_failures(expires_at);
