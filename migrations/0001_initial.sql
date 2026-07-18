CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY,
  access_token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_access_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS repair_sessions (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  vertical_id text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('demo', 'live')),
  status text NOT NULL CHECK (status IN (
    'draft', 'extracted', 'intake', 'spec_confirmed', 'shops_selected',
    'campaign_running', 'completed', 'deleted'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS repair_sessions_project_idx
  ON repair_sessions(project_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS source_documents (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES repair_sessions(id) ON DELETE CASCADE,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0),
  sha256 text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  extracted_text text,
  extraction_status text NOT NULL CHECK (extraction_status IN ('pending', 'completed', 'failed')),
  extraction_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS repair_specs (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES repair_sessions(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('draft', 'confirmed')),
  schema_version integer NOT NULL CHECK (schema_version > 0),
  payload jsonb NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  spec_hash text,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id, version),
  CHECK (
    (status = 'draft' AND spec_hash IS NULL AND confirmed_at IS NULL)
    OR (status = 'confirmed' AND spec_hash IS NOT NULL AND confirmed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS repair_specs_one_confirmed_idx
  ON repair_specs(session_id)
  WHERE status = 'confirmed';

CREATE TABLE IF NOT EXISTS shops (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  address text,
  website text,
  hours text,
  discovery_source text NOT NULL CHECK (discovery_source IN ('seed', 'tavily', 'manual')),
  source_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS shops_unique_project_phone_idx
  ON shops(project_id, phone)
  WHERE phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS session_shops (
  session_id uuid NOT NULL REFERENCES repair_sessions(id) ON DELETE CASCADE,
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  selected boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(session_id, shop_id)
);

CREATE TABLE IF NOT EXISTS campaigns (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES repair_sessions(id) ON DELETE CASCADE,
  repair_spec_id uuid NOT NULL REFERENCES repair_specs(id) ON DELETE RESTRICT,
  spec_hash text NOT NULL,
  spec_snapshot jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'running', 'completed', 'failed')),
  mode text NOT NULL CHECK (mode IN ('live', 'replay')),
  idempotency_key text NOT NULL UNIQUE,
  ai_disclosure_accepted boolean NOT NULL DEFAULT false,
  recording_consent_confirmed boolean NOT NULL DEFAULT false,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS calls (
  id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  kind text NOT NULL DEFAULT 'quote' CHECK (kind IN ('quote', 'negotiation')),
  provider text NOT NULL DEFAULT 'elevenlabs',
  provider_conversation_id text UNIQUE,
  provider_call_id text,
  style_profile text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'queued', 'ringing', 'connected', 'collecting_quote', 'waiting_callback',
    'completed', 'declined', 'no_answer', 'failed'
  )),
  outcome text CHECK (outcome IN ('quote', 'callback_commitment', 'declined', 'no_answer', 'failed')),
  current_objective text,
  duration_seconds integer NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  transcript jsonb NOT NULL DEFAULT '[]'::jsonb,
  recording_url text,
  failure_reason text,
  dispatch_started_at timestamptz,
  dispatch_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(campaign_id, shop_id, kind)
);

CREATE TABLE IF NOT EXISTS quotes (
  id uuid PRIMARY KEY,
  call_id uuid NOT NULL UNIQUE REFERENCES calls(id) ON DELETE CASCADE,
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('complete', 'incomplete', 'range_only', 'declined')),
  subtotal numeric(12,2) CHECK (subtotal >= 0),
  tax numeric(12,2) CHECK (tax >= 0),
  total numeric(12,2) CHECK (total >= 0),
  total_range jsonb,
  currency char(3) NOT NULL DEFAULT 'USD',
  warranty_text text,
  warranty_days integer CHECK (warranty_days >= 0),
  earliest_date date,
  valid_until date,
  completeness numeric(4,3) NOT NULL CHECK (completeness >= 0 AND completeness <= 1),
  conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  confirmed_in_call boolean NOT NULL DEFAULT false,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quote_items (
  id uuid PRIMARY KEY,
  quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN (
    'parts', 'labor', 'diagnostic', 'shop_supply', 'disposal', 'tax', 'other'
  )),
  description text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  included boolean NOT NULL DEFAULT true,
  parts_grade text,
  disclosure_note text,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS evidence_spans (
  id uuid PRIMARY KEY,
  call_id uuid NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  quote_id uuid REFERENCES quotes(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  turn_index integer NOT NULL CHECK (turn_index >= 0),
  speaker text NOT NULL CHECK (speaker IN ('agent', 'shop', 'customer')),
  transcript_text text NOT NULL,
  time_seconds numeric(10,3) NOT NULL CHECK (time_seconds >= 0)
);

CREATE TABLE IF NOT EXISTS negotiations (
  id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  call_id uuid NOT NULL UNIQUE REFERENCES calls(id) ON DELETE CASCADE,
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  original_quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE RESTRICT,
  leverage_quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE RESTRICT,
  revised_quote_id uuid REFERENCES quotes(id) ON DELETE RESTRICT,
  asks jsonb NOT NULL,
  approved_at timestamptz NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('pending', 'revised', 'rejected', 'failed')),
  provider_conversation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (original_quote_id <> leverage_quote_id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id uuid REFERENCES repair_sessions(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_events_session_idx
  ON audit_events(session_id, created_at);

CREATE TABLE IF NOT EXISTS webhook_events (
  id uuid PRIMARY KEY,
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
  error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE(provider, provider_event_id)
);
