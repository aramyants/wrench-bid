# Integrations

## Secret handling

Provider credentials belong only in `.env.local`, a deployment secret manager, or Docker/Kubernetes secrets. Never prefix them with `VITE_`, paste them into source, expose them through capability responses, or commit them.

The credentials supplied in the original chat should be considered exposed and rotated before use. They were intentionally not written to this workspace.

## ElevenLabs

An API key alone cannot complete live calling. Configure:

```text
ELEVENLABS_API_KEY
ELEVENLABS_INTAKE_AGENT_ID
ELEVENLABS_CALLER_AGENT_ID
ELEVENLABS_NEGOTIATOR_AGENT_ID
ELEVENLABS_PHONE_NUMBER_ID
ELEVENLABS_WEBHOOK_SECRET
ELEVENLABS_TELEPHONY_PROVIDER=twilio|sip
ELEVENLABS_ENVIRONMENT=production
OUTBOUND_CALLS_ENABLED=false
MAX_CAMPAIGNS_PER_PROJECT_PER_DAY=3
SUPPRESSED_PHONE_NUMBERS=+15551234567,+15557654321
```

The phone-number ID must refer to an imported Twilio number or configured SIP trunk. The application uses:

- `GET /v1/convai/conversation/token` for a private WebRTC intake token.
- `POST /v1/convai/{twilio|sip}/outbound-call` for calls.
- `GET /v1/convai/conversations/{id}/audio` through an authorized application proxy.
- `DELETE /v1/convai/conversations/{id}` during user-requested session deletion.
- HMAC post-call webhooks at `POST /api/webhooks/elevenlabs`.

### Intake agent contract

Configure a client tool named `update_repair_spec`:

```json
{
  "path": "vehicle.mileage",
  "value": 62000
}
```

For `operations`, `value` may be an array of description strings or structured operation objects. Stable allowed paths are `vehicle.year`, `vehicle.make`, `vehicle.model`, `vehicle.trim`, `vehicle.mileage`, `vehicle.vinLast8`, `location.city`, `location.region`, `location.postal`, `completionByDays`, and `operations`.

Allowed paths are defined in `updateDraftRepairSpec`. The backend rejects unknown paths and any edit after confirmation. The intake prompt should ask only about missing/unverified fields and must not diagnose repairs.

### Caller/negotiator data collection

Configure structured data collection with these stable keys so webhook normalization remains deterministic:

```text
call_outcome
parts
labor
diagnostic_fee
shop_supply_fee
disposal_fee
tax
all_in_total
warranty
warranty_days
earliest_appointment       # YYYY-MM-DD
quote_expiration           # YYYY-MM-DD
conditions
```

The caller receives dynamic variables containing the sealed RepairSpec JSON, required fields, shop name, disclosure rule, and terminal-outcome rule. The negotiator receives exact stored quote IDs/terms and only user-approved asks.

The normalizer attempts transcript matches for every supported monetary term, warranty term, date, and condition. Money and numeric evidence uses complete parsed tokens at cent precision, so structured `600` does not match a transcript containing only `$1,600`. Agent utterances never confirm evidence. Only a total exactly matched to a shop utterance sets `confirmedInCall`; totals without that evidence receive `missing_total_transcript_evidence` and are excluded from recommendations, benchmarks, and negotiation leverage.

### Webhook setup

Create an HMAC webhook pointing to:

```text
https://YOUR_PUBLIC_HOST/api/webhooks/elevenlabs
```

Enable `transcript` and `call_initiation_failure`. Audio is fetched on demand instead of accepting large base64 audio webhooks. The signed `wrenchbid_call_id` must be echoed so an early event can be ownership-mapped before its raw payload is retained. Failed inbox events can be reclaimed immediately; `received` leases become reclaimable after five minutes, while a fresh duplicate receives retryable `503`. Terminal call transitions are conditional and monotonic; transcript, quote/evidence, and negotiation changes commit atomically so a competing terminal event cannot overwrite them. Monitor persistent failed or stale-received rows.

Do not blindly retry outbound requests. ElevenLabs does not document an idempotency key for these endpoints; an ambiguous timeout may still have created a call.

## Tavily

Configure `TAVILY_API_KEY`. WrenchBid sends bounded basic searches with at most ten results and no answer, images, or raw page body. This caps each search at the basic credit tier. Returned content is treated as an untrusted lead, not authoritative business data.

Tavily-extracted phone text is always persisted as unverified. Before selection, the user must check an official business source, re-enter the exact E.164 number, and submit the explicit call-destination attestation. Manually added shops require the same attestation. The server persists the verification state and rejects every unverified destination at campaign and negotiation launch, then atomically rechecks that state, both campaign consents, E.164 format, and the current suppression list immediately before each provider request.

## WOZ token

The supplied “Woz API key” is shaped like an encoded refresh-token/organization object, but no authoritative provider base URL or API contract was identifiable. The application exposes `WOZ_API_KEY` and `WOZ_API_BASE_URL` placeholders but sends the token nowhere. An agent must identify the exact provider and official documentation before adding an adapter.

## Document extraction

The current live extractor supports text-based PDF estimates only. It verifies the declared type, file size, `%PDF-` signature, extracts up to 50 pages with PDF.js, hashes/stores the original, and produces a draft with evidence confidence. Scanned PDFs, PNG, and JPEG require a separate OCR/vision adapter and malware/content scanning before being advertised as live-supported.
