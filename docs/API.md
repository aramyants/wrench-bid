# Internal API

All user-data routes rely on the opaque project cookie and return `Cache-Control: no-store`.

| Method   | Route                           | Purpose                                               |
| -------- | ------------------------------- | ----------------------------------------------------- |
| `GET`    | `/api/health`                   | Database readiness and non-secret capability flags    |
| `GET`    | `/api/capabilities`             | Non-secret live-feature availability                  |
| `GET`    | `/api/requests`                 | Current project request history                       |
| `POST`   | `/api/requests`                 | Consent-bearing multipart PDF upload (`estimate`)     |
| `GET`    | `/api/requests/:id`             | Project-scoped request/spec/document/shop snapshot    |
| `DELETE` | `/api/requests/:id`             | Cascading request and blob deletion                   |
| `POST`   | `/api/requests/:id/actions`     | Draft field update or immutable confirmation          |
| `POST`   | `/api/requests/:id/discover`    | Bounded Tavily shop discovery                         |
| `POST`   | `/api/requests/:id/shops`       | Add a manually verified shop                          |
| `PATCH`  | `/api/requests/:id/shops`       | Re-enter and attest a discovered shop phone           |
| `POST`   | `/api/requests/:id/voice-token` | Rate-limited private ElevenLabs WebRTC token          |
| `POST`   | `/api/campaigns`                | Consent-gated campaign creation and one-time dispatch |
| `GET`    | `/api/campaigns/:id`            | Project-scoped calls/quotes/evidence snapshot         |
| `POST`   | `/api/negotiations`             | User-approved real negotiation with stored leverage   |
| `GET`    | `/api/calls/:id/audio`          | Authorized provider audio stream                      |
| `POST`   | `/api/webhooks/elevenlabs`      | Public HMAC-verified provider webhook                 |

The API is application-internal, not a public third-party API. Error responses use a generic message and may include a server-side `requestId`; validation responses include safe field issues.

## Mutation contracts

All browser mutations require a same-origin `Origin`/`Referer` when the browser supplies one. JSON routes use `Content-Type: application/json`; the upload route uses multipart data:

```text
POST /api/requests
estimate=<PDF file, text-based, 1 byte through 10 MiB>
consent=true
```

It returns `201 RequestSnapshot`; malformed/missing files return `400`, unsupported content type `415`, and invalid consent/content `422`.

```json
POST /api/requests/:id/actions
{ "action": "update_spec", "path": "vehicle.mileage", "value": 62000, "source": "manual" }
{ "action": "confirm_spec" }

POST /api/requests/:id/discover
{ "query": "repair shops near Charlotte NC" }

POST /api/requests/:id/shops
{
  "name": "Example Auto",
  "phone": "+17045551234",
  "address": "1 Main St",
  "website": "https://example.com",
  "phoneVerificationAttested": true
}

PATCH /api/requests/:id/shops
{ "shopId": "uuid", "phone": "+17045551234", "phoneVerificationAttested": true }
```

Draft updates return `{ "spec": RepairSpec }`. Confirmation is idempotent and seals the current row under a database lock. Updates after sealing return `409`; incomplete confirmation returns `422`. Discovery returns `{ "shops": Shop[] }` with `phoneVerified: false` unless that exact saved destination was previously attested. Manual and verification phones must be E.164. Duplicate project destinations return `409`.

```json
POST /api/campaigns
{
  "sessionId": "uuid",
  "shopIds": ["uuid", "uuid", "uuid"],
  "idempotencyKey": "uuid",
  "aiDisclosureAccepted": true,
  "recordingConsentConfirmed": true
}
```

The client must persist one `idempotencyKey` for a launch intent and reuse it after a lost response. The server returns the existing campaign for the same project/key and dispatches only unclaimed queued quote calls. Immediately before each provider request, the atomic dispatch claim rechecks verified E.164 state, both consents, and the current suppression list. Unsafe unclaimed work is terminally failed without contacting the provider. Creation rejects disabled/incomplete provider configuration with `503`, unverified/duplicate/suppressed destinations with `422`, and the transactionally serialized daily project limit with `429`.

```json
POST /api/negotiations
{
  "campaignId": "uuid",
  "originalQuoteId": "uuid",
  "leverageQuoteId": "different uuid",
  "asks": ["beat_or_match", "waive_shop_supply"]
}
```

Both quotes must be complete, comparable, stored quotes from different shops in the same owned campaign. Each all-in total must also equal a complete numeric token in a shop transcript utterance; structured provider data, an agent utterance, or a substring match is not eligible for recommendation or leverage. Negotiation dispatch rechecks the verified destination, both original campaign consents, and suppression state in its atomic claim. Success returns `201 { "negotiationId": "uuid", "callId": "uuid" }`.

## Provider webhook contract

`POST /api/webhooks/elevenlabs` requires the raw-body `ElevenLabs-Signature` HMAC header. The configured agents must echo the signed initiation dynamic variable `wrenchbid_call_id`; this lets a valid webhook reconcile a call even if it arrives before the outbound HTTP response is persisted. A supported event is persisted only after it maps to an existing call/session. Failed rows are reclaimable immediately; a `received` processing lease is reclaimable after five minutes. Fresh in-flight duplicates and temporarily unmapped supported events return retryable `503`; processed/ignored duplicates return `200 { "duplicate": true }`. Terminal call updates are monotonic, and quote/evidence plus negotiation updates share the same transaction as the winning call transition.

Caller dynamic variables: `wrenchbid_call_id`, `shop_name`, `repair_spec_json`, `required_quote_fields`, `counterparty_style`, `identity_policy`, `disclosure_policy`, `scope_policy`, and `terminal_outcome_policy`.

Negotiator dynamic variables: `wrenchbid_call_id`, `negotiation_id`, target/original quote fields, leverage quote fields, `approved_asks`, `disclosure_policy`, and `quote_integrity_policy`. Structured collection keys are listed in `docs/INTEGRATIONS.md`.

## Common statuses

- `200/201`: success; `204` is not used by current JSON routes.
- `400/415/422`: malformed, unsupported, or semantically invalid input.
- `401/403`: missing project authorization, invalid webhook signature, or cross-origin mutation.
- `404`: the resource is absent or outside the current project.
- `409`: immutable-state or concurrent-state conflict.
- `429`: bounded search/campaign limit; honor `Retry-After` when present.
- `502/503`: provider failure or disabled/incomplete runtime capability.
