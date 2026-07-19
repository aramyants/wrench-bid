# Production-readiness audit

Audit date: 2026-07-19. Every command result below was executed during this audit, not inherited from documentation.

## Actual architecture and stack

- TanStack Start (React 19, Vite 8, Nitro) full-stack app; file routes under `src/routes/` serve both pages and `/api/*` handlers.
- PostgreSQL 17 via `postgres` driver; ordered idempotent SQL migrations (`migrations/0001`–`0003`) run under an advisory lock by `scripts/migrate.mjs`.
- ElevenLabs: WebRTC voice intake with server-issued conversation tokens; TTS (`eleven_flash_v2_5`) and text-to-dialogue (`eleven_v3`) for the deterministic arena; agent `simulate-conversation/stream` for the dynamic AI-vs-AI negotiation; HMAC-verified post-call webhooks. All model identifiers are environment-configurable (`ELEVENLABS_TTS_MODEL_ID`, `ELEVENLABS_DIALOGUE_MODEL_ID`, `ELEVENLABS_SIMULATION_LLM`).
- Tavily server-side search for shop discovery and simulation grounding; results are labeled untrusted leads until phone-verified by the user.
- No OpenAI dependency exists: document extraction is deterministic PDF.js text extraction plus rule-based field proposal with per-field evidence and confidence. This is a deliberate zero-hallucination intake path, documented in `docs/model-selection.md`.
- Zustand + localStorage persistence is demo-session-only (`demoOnlyState` partialization); live data lives in PostgreSQL behind tenant-scoped opaque HTTP-only cookies.

## Vertical note

The implemented vertical is auto repair (WrenchBid), a valid vertical under the challenge brief ("car repair" is named explicitly). Vertical parameters are configuration (`src/lib/wrenchbid/verticals/auto-repair.ts`): quote fields, benchmarks, red flags, negotiation levers, counterparty styles, and agent policy. Switching verticals means swapping this config, as the brief requires.

## Feature classification

| Feature | Classification | Evidence |
| --- | --- | --- |
| PDF intake → draft spec with per-field evidence/confidence | Complete and verified | Production-image lifecycle run in `docs/VERIFICATION.md`; MIME/signature/size checks; SHA-256; failure-path cleanup |
| Manual correction + confirmation → immutable versioned spec | Complete and verified | 409 on post-confirmation mutation; DB `CHECK` + unique partial index; spec hash + per-campaign snapshot |
| Voice intake (ElevenLabs WebRTC, server token) | Implemented but unverified live | `@elevenlabs/react` + `/api/requests/$id/voice-token`; needs a configured intake agent to exercise |
| Deterministic Counter-Agent arena (3 styles, voiced) | Complete and verified | Browser-verified with real ElevenLabs audio; policy-driven, not screenplay; labeled synthetic |
| Dynamic AI-vs-AI negotiation (agent simulation, streamed) | Complete and verified once | NDJSON stream run recorded in `docs/VERIFICATION.md` with a real caller agent |
| Genuine-leverage negotiation gating | Complete and verified | Server + engine only accept stored, verified, cheaper quotes; evals prove refusal otherwise |
| Quote normalization + transcript evidence | Complete and verified | 76 offline eval tests over 14 golden calls exercise the exact production module |
| Ranking with 30%-below-median red flag | Complete and verified | Boundary evals at exactly 0.7×/1.5×; unconfirmed totals excluded from the benchmark |
| Webhook ingestion (HMAC, idempotent, monotonic outcomes) | Implemented but unverified live | Signature/timestamp verification, `UNIQUE(provider, provider_event_id)`, existing-quote guard; needs signed provider traffic |
| Outbound telephony (Twilio/SIP via ElevenLabs) | Isolated by design | No PSTN access exists; `OUTBOUND_CALLS_ENABLED=false` default, capability-gated, consent-gated; UI copy is transport-neutral |
| Session deletion (user-controlled, cascading) | Complete and verified | Two-tenant regression: cross-tenant 404, owner delete, zero residual rows/files |
| Health/readiness | Complete | `/api/health` returns 200/503 with DB latency and capability flags |
| Authentication for public multi-user launch | Missing by decision | Anonymous tenant cookies only; documented as a pilot boundary |
| Licensed market benchmark | Missing | Campaign median is the only benchmark; labeled as such in UI |
| OCR for scanned PDFs | Missing | Text-layer PDFs only |
| CI end-to-end browser suite | Missing | Browser checks were manual; CI runs unit/eval/build |

## Security, reliability, data integrity

- Verified present: server-only secrets, HMAC webhook verification with timestamp window and timing-safe compare, same-origin mutation checks, tenant ownership on every query, hashed access tokens, rate limits on voice/token/simulation endpoints, security headers, non-root read-only container, loopback-only ports, cascading deletion, upload validation and private storage, `npm audit` clean (0 vulnerabilities including dev).
- Risks that remain: anonymous cookie tenancy is not user auth (P1 before public launch); webhook processing is in-request rather than a durable worker (P2); retention is a config value without a scheduler (P2); Tavily-derived phone numbers require user attestation before any live call (enforced) but the attestation is self-declared (accepted risk, documented).
- Data integrity: money arithmetic is integer-cents (`src/lib/wrenchbid/money.ts`); missing fees stay `undefined`/`NULL` and produce warnings — never zero; DB uses `numeric(12,2)`; non-USD quotes get `currency_mismatch` and are never blended into the USD benchmark.

## Accessibility

Transcripts use `aria-live="polite"`; forms use labeled controls; status pills pair icon + text (not color-only); keyboard focus is visible via the design system. Not audited end-to-end against WCAG 2.2 AA — listed in `docs/limitations.md`.

## Priorities

- P0 (demo-breaking): none found. The deterministic demo path runs with only `ELEVENLABS_API_KEY`; without it the arena reports the missing capability instead of failing silently.
- P1 fixed this audit: telephony-implying UI copy ("Dialing shop", "Ringing", "Calls connected", "Required before dialing") replaced with transport-neutral wording; arena results now survive browser refresh (sessionStorage, cleared on Reset); float money arithmetic replaced with cents; eval coverage expanded 36 → 76 (prompt injection, unauthorized commitment, currency mismatch, interruption, hard sell, conditional discount).
- P1 remaining (external): configure rotated ElevenLabs agents + Tavily key and run the live role-play evaluation before any provider-backed demo.
- P2: durable webhook worker, retention scheduler, real auth, OCR, licensed benchmark, Playwright CI suite.
- P3: latency/cost telemetry dashboards, additional verticals.

## Completion estimate

- Before this audit: ~72% against the challenge brief. Evidence: all local verification passed (typecheck, 58 tests, lint, build, Docker, browser checks documented with dates), but eval scenario coverage was partial (36 checks), money arithmetic used floats, campaign UI used telephony language for web sessions, model IDs were hardcoded, and the jury documentation package (compliance map, runbook, model selection, threat model, licensing) did not exist.
- After this audit: ~88% jury-ready. Evidence: 102 unit/eval tests pass (`npm run test`), 76 eval assertions pass (`npm run eval`), lint/typecheck/build pass, all fixes above landed, full jury doc set exists. The remaining 12% requires external accounts (rotated ElevenLabs agent configuration, Tavily key, live role-play evaluation) and post-hackathon work (auth, durable workers, OCR, licensed benchmark).
