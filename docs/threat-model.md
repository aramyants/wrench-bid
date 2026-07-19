# Threat model

Assets: customer job specs and documents, negotiation transcripts/quotes, provider API keys, tenant isolation, the honesty guarantees of the agent.

| Threat | Vector | Mitigation | Status |
| --- | --- | --- | --- |
| Secret exfiltration to client | Bundled env vars | Server-only env parsing; no `VITE_` secrets; CI secret-pattern scan | Enforced |
| Cross-tenant data access | Guessed IDs | Every query joins on `project_id` from an HttpOnly cookie with hashed token; two-tenant regression verified 404s | Verified |
| CSRF / cross-origin mutation | Hostile form posts | `assertSameOrigin` on all mutations (403 verified); SameSite=Lax cookie | Verified |
| Forged webhooks | Fake post-call payloads | HMAC-SHA256 with timestamp window + timing-safe compare; unsigned rejected 401 | Enforced |
| Replayed/duplicate webhooks | Provider retries or attackers | `UNIQUE(provider, provider_event_id)`; monotonic terminal outcomes; existing-quote guard | Enforced |
| Malicious upload | Polyglot/oversized/path-traversal files | MIME + magic-byte + 10MB checks, server-generated storage keys, private volume, read-only container | Enforced |
| Prompt injection via shop speech or documents | "Ignore your instructions…" in transcript/PDF | Structured pipeline only trusts spoken-evidence matching; injected values never become evidence (eval-gated); agent policy forbids compliance | Eval-gated |
| Fabricated leverage | Model invents a competing bid | Server-side leverage requires a stored, verified, cheaper quote ID; engine emits explicit refusal otherwise | Eval-gated |
| Unauthorized commitment | Shop pressures deposit/booking | Agent policy + eval gate; binding actions require user action outside the call | Eval-gated |
| SSRF via discovery | Attacker-controlled URLs | Tavily is the only outbound search; audio proxy only calls the provider API with server-known IDs | Enforced |
| Abuse of paid endpoints | Token/TTS/simulation spam | Per-project and per-IP rate limits; simulation capped 3/5min | Enforced |
| Rogue operator dialing real businesses | Misconfigured live mode | `OUTBOUND_CALLS_ENABLED=false` default; consent + phone-verification attestation + suppression list re-checked at claim time | Enforced |
| Container escape / lateral movement | App compromise | Non-root, read-only FS, dropped capabilities, `no-new-privileges`, loopback-only publish | Enforced |

Residual risks: anonymous tenancy (no account recovery/authn), in-request webhook processing, self-attested phone verification, no WAF/rate-limit at the edge. See `docs/limitations.md` and `docs/SECURITY.md`.
