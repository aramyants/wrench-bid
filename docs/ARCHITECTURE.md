# Architecture

## System flow

```text
Browser
  │  opaque HttpOnly project cookie + same-origin requests
  ▼
TanStack Start / Node server
  ├── PDF validation + extraction ───────► protected upload volume
  ├── domain services/repositories ──────► PostgreSQL
  ├── Tavily adapter ────────────────────► candidate business pages
  ├── ElevenLabs adapter ────────────────► WebRTC tokens / Twilio or SIP calls
  └── HMAC webhook inbox ◄─────────────── ElevenLabs post-call events
          │
          └── calls → transcript → quote items → evidence → ranking/report
```

The browser never receives provider secrets, extracted raw document text, database credentials, or unscoped records. Live records are not persisted to `localStorage`; only the clearly labeled synthetic demo is browser-persisted.

## Trust boundaries

| Boundary                  | Enforcement                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Browser → application     | Same-origin mutation check, HTTP-only opaque project cookie, Zod input validation                          |
| Application → database    | Every user-data query joins or filters through `project_id`; foreign keys and checks enforce relationships |
| Application → providers   | Server-only environment variables, bounded timeouts, validated request shapes                              |
| ElevenLabs → webhook      | HMAC/timestamp, owned call mapping before persistence, dedupe key, reclaimable processing lease            |
| Application → file volume | Random storage keys, validated `%PDF-` signature, 10 MB limit, non-public directory, `0600` files          |

## Durable entities

The canonical schema is the ordered [`migrations/`](../migrations/) directory. Never edit an applied migration; add the next numbered file.

- `projects`: opaque browser workspace and hashed access token.
- `repair_sessions`: project-owned workflow state.
- `source_documents`: blob key, original metadata, checksum, extraction state, and server-only text.
- `repair_specs`: versioned JSON payload/evidence. A confirmed row has a hash and timestamp.
- `shops` and `session_shops`: candidate counterparties, persisted E.164 verification attestation, and per-request selection.
- `campaigns`: references a confirmed spec and embeds the exact immutable spec snapshot/hash used by all calls.
- `calls`: quote or negotiation attempts, provider IDs, dispatch claim, transcript, terminal outcome, and audio availability.
- `quotes`, `quote_items`, `evidence_spans`: normalized terms and transcript-level provenance.
- `negotiations`: user approval, original/leverage/revised quote IDs, and outcome.
- `audit_events`: append-only user/workflow facts.
- `webhook_events`: call/session-owned provider inbox with a unique dedupe identity, processing lease, attempt count, and cascading deletion.

## Core invariants

1. A campaign cannot start without a confirmed spec and its SHA-256 hash.
2. The campaign stores that spec as a JSON snapshot; later draft edits cannot change call scope.
3. At least three unique, request-owned shops with explicitly re-entered and attested E.164 numbers are required.
4. AI-disclosure authorization and recording-consent confirmation are required before dispatch.
5. Each outbound attempt is claimed in the database before contacting ElevenLabs. The atomic claim rechecks the exact verified E.164 destination, AI-disclosure authorization, recording consent, call kind, queued state, and current operator suppression list.
6. An ambiguous provider timeout is recorded as failed and is not retried automatically because the first request may have placed a real call.
7. Every call resolves to `quote`, `callback_commitment`, `declined`, `no_answer`, or `failed`. A terminal transition is monotonic; its transcript, quote/evidence rows, and negotiation outcome commit in the same transaction.
8. Negotiation leverage must be a different complete stored quote from the same campaign, and each total must equal a full numeric token in a shop transcript utterance. Substring matches such as `600` inside `1,600` are rejected.
9. A bid below 70% of the comparable median is flagged `suspiciously_low`.
10. Session deletion first resolves artifacts through project ownership, then deletes the project-scoped parent session and relies on foreign-key cascades for relational records including raw webhook payloads; a late unowned event is not persisted.

## Vertical configuration

Auto-repair behavior lives in [`auto-repair.ts`](../src/lib/wrenchbid/verticals/auto-repair.ts): supported documents, required quote fields, benchmark thresholds, red flags, negotiation levers, behavior profiles, and honesty/disclosure rules. A second vertical should add a new configuration and extractor/normalizer rather than rewrite the orchestration layer.

## Client state

Zustand remains a rendering cache so the existing UI can consume normalized domain objects. `partialize` persists only demo-owned entities. Live routes refresh from tenant-scoped APIs after navigation or reload; PostgreSQL is the source of truth.
