# WrenchBid — Phase 1: end-to-end demo flow (historical)

> This file records the original Phase 1 mock-only demo plan. The repository now also contains a server-backed implementation. Start with `README.md` and `docs/AGENT_HANDOFF.md`; do not treat the “out of scope” section below as current status.

Priority 1 only: a fully clickable demo of the full user journey using mocked, in-memory data. No Supabase, no ElevenLabs/OpenAI/Tavily calls. All service boundaries exist as typed TypeScript interfaces with mock implementations so real integrations can be swapped in later.

## Design system

- Dark charcoal / near-black background (`oklch(0.16 0.01 250)`), warm off-white content surfaces (`oklch(0.97 0.01 85)`), electric lime primary (`oklch(0.86 0.20 130)`), amber caution, red error, green verified.
- Fonts: **Space Grotesk** (UI) + **JetBrains Mono** (VIN, hashes, prices, timestamps). Loaded via `<link>` in `__root.tsx`.
- All colors as semantic tokens in `src/styles.css`. Every status uses icon + label + color (never color alone).
- Subtle automotive-grid background pattern via CSS; controlled shadows; no glassmorphism, no fake charts.

## Routes (all under `src/routes/`)

```text
index.tsx                          → landing
demo.tsx                           → jumps into seeded session
requests.new.tsx                   → upload page
requests.$id.extraction.tsx        → extracted-fields evidence
requests.$id.intake.tsx            → voice interview
requests.$id.spec.tsx              → RepairSpec review + confirm
requests.$id.shops.tsx             → shop selection (demo + live tabs)
campaigns.$id.tsx                  → live call campaign dashboard
campaigns.$id.compare.tsx          → quote comparison
campaigns.$id.negotiate.tsx        → negotiation approval + result
campaigns.$id.report.tsx           → final recommended-deal report
history.tsx                        → session list (light)
```

Each route defines its own `head()` metadata. Global chrome (top nav with logo, Demo drawer trigger) lives in `__root.tsx`.

## Domain model & mock store

`src/lib/wrenchbid/`:

- `types.ts` — TS types + Zod schemas for `RepairSpec`, `Shop`, `Call`, `Quote`, `QuoteItem`, `EvidenceSpan`, `Negotiation`, `FinalReport`, `AuditEvent`.
- `store.ts` — Zustand store holding sessions/campaigns/calls/quotes in memory, with actions used by the demo drawer (advance extraction, start calls, reveal hidden fee, apply negotiation, etc.). Persisted to `localStorage` so refreshes don't wipe the demo.
- `seed.ts` — Toyota Camry / Charlotte NC seed: synthetic estimate, mileage initially `52,000` (corrected to `62,000`), confirmed RepairSpec with version + spec hash, three shops (Budget Brake Center, Precision Auto Works, Queen City Garage) with `demo_policy`, three completed calls with transcripts and evidence spans, quotes matching the spec's example numbers ($574 / $616.69→$585 / $645), one negotiated revision.
- `services/` — typed interfaces `OpenAIService`, `ElevenLabsService`, `TavilyService` with `mock*.ts` implementations. Real adapters can drop in later.
- `hooks/` — small selector hooks (`useSession`, `useCampaign`, `useCall`) wrapping the store.

Nothing calls a real network. `import.meta.env.VITE_DEMO_MODE` toggles the Demo Control Drawer visibility (default on in Phase 1).

## Reusable components (`src/components/wrenchbid/`)

- `AppShell` — top nav + optional Demo drawer trigger.
- `DemoControlDrawer` — right-side sheet with all scripted actions listed in the spec.
- `EvidenceField` — value + source badge + confidence bar + excerpt + edit.
- `StatusPill` — icon + label + color, shared across call/quote/spec statuses.
- `SpecCard`, `SpecHash`, `MonoValue` — RepairSpec presentation.
- `CallCard` — shop, status, duration, objective, quote-completion, transcript preview, audio-availability, outcome.
- `CampaignTimeline` — started → connected → quotes → normalized.
- `QuoteComparisonTable` (desktop) + `QuoteCardStack` (mobile) with sort/filter, evidence drawer, warning badges (hidden fee, non-comparable scope, suspiciously low).
- `EvidenceDrawer` — transcript excerpt + audio scrubber placeholder + timestamp jump.
- `NegotiationApprovalCard` — checklist of asks, competing-quote selector restricted to stored completed quotes, before→after result.
- `ReportSummary` — hero result, sections, download/copy/delete actions.
- `VoiceIntakePanel` — mock adapter behind `ElevenLabsService` interface: connect/disconnect, mute, speaking/listening indicator, live transcript, waveform (CSS-only), duration timer, RepairSpec progress checklist. Mock plays a scripted conversation that fills missing spec fields.
- Empty/error states from the spec's full list, each explaining what happened, what's saved, next step.

## Flow behavior

1. `/` — hero, CTAs, three-step section, labelled demo numbers ($780 → $616.69 → $585).
2. `Start a repair request` → `/requests/new`. `Use sample dealer estimate` creates a session in the store and routes to `/requests/{id}/extraction` after a fake progress bar.
3. Extraction page shows the estimate preview (rendered synthetic doc) with highlight overlays, extracted fields with confidence, mileage flagged as `Needs confirmation` at `52,000`. Correcting to `62,000` writes an audit event visible on the page.
4. `/intake` — mock voice conversation via `VoiceIntakePanel`; store fills remaining spec fields as scripted turns fire.
5. `/spec` — review, confirm. Confirming freezes the version and computes a spec hash (`sha256` of canonical JSON, hex).
6. `/shops` — demo tab preselects the three seeded shops; live tab shows a disabled Tavily placeholder with a "Live discovery available once connected" state.
7. Starting the campaign navigates to `/campaigns/{id}`. The store animates statuses (`Queued → Ringing → Connected → Collecting quote → Completed`) on a scripted timer; the Demo drawer can also step this manually. Prominent `Recorded demo session — not a live call` label.
8. `/compare` — table + card views, all features from spec, evidence drawer with transcript excerpts and playable audio placeholder.
9. `/negotiate` — user approves asks against Precision Auto Works using Budget Brake Center's verified quote as leverage; before→after card animates to $585.
10. `/report` — recommended deal, download (client-side JSON + printable HTML), copy summary, delete session (clears the session from the store).

## Constraints honored

- No diagnosis, no safety advice, no invented competing quotes (selector reads only stored completed quotes), no legal-binding claims, no hidden unknowns, no ranking of non-comparable scope without a warning, no "live" labels on replays, no fake charts, no payments/booking, no auth.

## Out of scope for this phase

Supabase migrations, edge functions, real ElevenLabs/OpenAI/Tavily wiring, auth, `/history` beyond a simple list of sessions in the store, real audio recordings (placeholder waveform + timestamp UI only). All service adapters have clean typed interfaces so a Phase 2 can wire real backends without touching UI code.

## Technical details

- Add deps: `zustand`, `zod`, `react-hook-form`, `@hookform/resolvers`, `framer-motion`, `date-fns`. TanStack Query is already present; used for demo async illusions where useful.
- CSS: extend `src/styles.css` with new tokens (`--lime`, `--warm-surface`, `--amber`, `--verified`, `--warning`, `--danger`, `--grid-line`) mapped through `@theme inline`, plus a `.mono` utility using JetBrains Mono. Load both fonts via `<link>` in `__root.tsx`.
- Spec-hash: canonical-JSON + `crypto.subtle.digest("SHA-256", ...)` in the browser.
- Routing: strictly file-based, no `src/pages/`, no hash-anchor pseudo-routes.
- No secrets in client code; service mocks read no env vars other than `VITE_DEMO_MODE`.

Once approved I'll build the full structure in one pass, seeded and clickable end-to-end.
