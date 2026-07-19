# Limitations

Honest boundaries of the current build.

- **No live telephony.** No Twilio/SIP/PSTN access exists in this environment. All voice is web-based (WebRTC intake, provider TTS, agent simulation). The outbound-call code path is capability-gated off (`OUTBOUND_CALLS_ENABLED=false`) and nothing in the UI claims a phone call occurred.
- **Deterministic arena is TTS over controlled content.** The three-lane arena voices policy-generated turns; it does not exercise barge-in, interruption audio, or full-duplex transport. The optional agent simulation is full-duplex reasoning but still a provider simulation, not a phone call.
- **Live-provider claims are unverified without credentials.** Intake agent, signed webhooks, audio retrieval, and Tavily discovery were verified only at the dates recorded in `docs/VERIFICATION.md`; fresh rotated credentials must re-verify them.
- **Anonymous tenancy, not accounts.** Opaque HTTP-only project cookies isolate browsers; a public multi-user launch requires real authentication (see `docs/SECURITY.md`).
- **Benchmark is the campaign median.** No licensed market-price source (RepairPal etc.) is connected; the UI labels the median as such. Red-flag ratios come from vertical config.
- **Text-layer PDFs only.** Scanned/image PDFs need an OCR path that does not exist yet; extraction fails visibly rather than guessing.
- **Webhook processing is in-request.** Idempotent and transactional, but not a durable queue; a crash between receipt and processing relies on provider retries.
- **Retention is a config value.** `RETENTION_DAYS` exists; a scheduled purger does not. Interactive deletion works and is verified.
- **Accessibility is designed-in but not audited.** aria-live transcripts, labeled forms, icon+text status; no full WCAG 2.2 AA audit or screen-reader pass has been performed.
- **No CI browser e2e.** Browser verification was manual (documented); CI runs format/lint/typecheck/unit/eval/build/audit/secret-scan.
- **Latency/cost telemetry is partial.** The simulation stream was timed manually; there is no per-negotiation cost ledger.
