# Challenge compliance map

Maps every requirement of the ElevenLabs "The Negotiator" brief to product surface, source, tests, and demo moment. Demo timestamps refer to the 90-second script in `docs/demo-runbook.md`.

| Brief requirement | Screen | Source | Test/eval | Demo |
| --- | --- | --- | --- | --- |
| Structured job spec from documents | `/requests/$id/extraction` | `document-extraction.server.ts`, `requests.server.ts` | `document-extraction.test.ts`; production-image lifecycle in `docs/VERIFICATION.md` | 0:00–0:10 |
| Voice-interview intake on ElevenLabs Agents | `/requests/$id/intake` | `@elevenlabs/react` + `api.requests.$id.voice-token.ts`, `elevenlabs.server.ts` | Live-config required; token gating + audit event in code | tech demo step 2 |
| Both paths → same confirmed spec, reused verbatim | `/requests/$id/spec` | `types.ts` (one `RepairSpecSchema`), campaign `spec_snapshot`/`spec_hash` | 409 immutability; DB constraints (`migrations/0001`) | 0:10–0:20 |
| User confirms spec before any calls | spec screen confirm action | `requests.server.ts` | verified 409 after confirm | 0:15 |
| ≥3 distinct negotiation styles | `/demo/arena` three lanes | `counter-agents.ts` (private policies) | `counter-agents.test.ts`; style evals | 0:25–0:55 |
| Itemised, comparable quotes with fees | compare/report screens | `call-normalization.ts` | 76 golden-call eval assertions | 1:15 |
| Price/terms change from gathered leverage | arena closer round | `buildNegotiationConversation`, `negotiations.server.ts` | leverage-gating evals (verified+cheaper only) | 0:55–1:15 |
| Leverage is genuine — never a fake bid | server-side approval flow | negotiation requires stored quote IDs; engine refuses otherwise | "never cites a stored quote without verified leverage" eval | 0:55 |
| AI disclosure, honestly handled | every agent opening + robot-question handling | `verticals/auto-repair.ts` agentPolicy | disclosure eval on every fixture (100% gate) | 1:25 |
| Friction: interruptions, refusals, evasion | eval suite + arena evasive lane | fixtures: `interrupted-call-failure`, `refusal-declined`, `evasive-queencity` | outcome evals | 1:25 |
| Every call ends in a structured outcome | campaign cards | `inferOutcome`, DB outcome enum | outcome eval per fixture | 1:15 |
| Ranked report with transcript evidence | `/campaigns/$id/report` | `ranking.ts`, `quote-evidence.ts` | ranking + evidence evals | 1:15 |
| 30%-below-market red flag | report warnings | `ranking.ts` + vertical config | exact-boundary evals | 1:15 |
| Vertical as configuration | n/a | `verticals/auto-repair.ts` | config consumed by pipeline + evals | — |
| Real market grounding | Tavily discovery + simulation source card | `tavily.server.ts` | live-config required; provenance labels in UI | tech demo step 5 |
| Golden calls & evals | n/a | `evals/` | `npm run eval` (76 checks) | 1:25 |
| Counterparty setup (simulated market allowed) | arena + optional agent simulation | brief permits counter-agents explicitly | — | 0:20 |

Telephony note: the brief's Twilio/SIP path is optional ("if you want to go beyond simulation"). This environment has no PSTN access, so the product uses the brief's third sanctioned setup — built counter-agents — over web audio, and never claims a phone call occurred. Outbound telephony code exists but is capability-gated off and labeled.
