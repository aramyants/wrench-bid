# Demo runbook

## Prerequisites

- `docker compose --env-file .env.local up --build` (or `npm ci && npm run dev` for the dev server).
- `.env.local` from `.env.example`. Required for the voiced demo: `ELEVENLABS_API_KEY` (server-side only). Optional: `ELEVENLABS_CALLER_AGENT_ID` + `TAVILY_API_KEY` enable the dynamic AI-vs-AI simulation. Nothing else is needed; telephony stays off.
- Demo data is self-seeding: the recorded Camry session (`sess_demo_camry`), demo campaign (`camp_demo_1`), and three Counter Agents load automatically on first visit. No manual seed command exists or is needed.
- Do a silent pre-flight once: open `/demo/arena`, run one scenario, then Reset.

## 90-second jury version

| ~Time | Action | Say / show |
| --- | --- | --- |
| 0:00 | Open `/` then `/requests/sess_demo_camry/extraction` | "One uploaded repair estimate became this structured, evidence-backed spec — every field shows its source excerpt and confidence." |
| 0:10 | Correct one field (e.g. mileage), confirm the spec | "The user corrects, then confirms. Confirmation freezes the spec — later edits create a new version; every negotiation pins this exact hash." |
| 0:20 | Open `/demo/arena`; point at the amber label | "Synthetic counterparties — no business is called. Three private pricing policies, one identical confirmed scope." |
| 0:25 | Click **Run 3 voiced scenarios** | Let the hidden-fee reveal play; narrate: "Budget hides a $45 shop fee until our agent asks 'is that truly all-in?' — hidden-fee discovery, on tape." Point at the transparent and evasive lanes completing. |
| 0:55 | Click **Start voiced negotiation** | "Second round: the agent may cite only stored quote q_budget — $574, transcript-confirmed. Precision's private floor answers: $616.69 drops to $585, warranty kept. Real stored leverage, not a script the presenter wrote." |
| 1:15 | Point at Before/Leverage/Revised metrics, then **Open full comparison** | "Before-and-after, itemised fees, transcript evidence per field, and a ranked recommendation — the 30%-below-market red flag is enforced, and an unevidenced total can never win." |
| 1:25 | Close: mention honesty | "Asked 'are you a robot?', it answers honestly — that's a hard eval gate, as is refusing to fabricate a competing bid. 76 offline evals enforce both. Session deletion wipes everything, verified to zero rows." |

If asked about AI disclosure or fabrication live: open `src/lib/wrenchbid/evals/golden-calls/robot-question-disclosure.json` or run `npm run eval` on stage (sub-second).

## Longer technical version (5–8 min)

1. `/requests/new` → upload the sample PDF with consent → extraction screen: per-field evidence, uncertainty, manual correction.
2. Voice intake: with a configured intake agent, start the WebRTC session (server-issued token; mic permission prompt; live transcript; the `update_repair_spec` tool writes corrections). Without one, play the voiced scripted intake — labeled "Scripted ElevenLabs voices · no phone call".
3. Confirm → immutability: retry an edit, show the 409.
4. Arena: run scenarios; open the presenter-only "Demo-only private policy" panel to show behaviors are policy-driven, not scripted dialogue.
5. Optional dynamic mode: **Start real-time simulation** — Tavily resolves a real Charlotte shop page as labeled public context; the ElevenLabs caller agent negotiates a full-duplex simulated conversation, streamed and voiced turn-by-turn.
6. `/campaigns/camp_demo_1/compare` and `/report`: itemisation, warnings, evidence links, ranking rationale.
7. Partial failure: point at eval `interrupted-call-failure` and per-call failure states; one failed session never blocks the campaign.
8. Delete the live request; show the 404 and empty history.

## Emergency fallback

- No `ELEVENLABS_API_KEY` or provider outage: the arena buttons surface the exact error; narrate over the unvoiced deterministic transcripts instead — all logic (hidden fee, leverage, revision to $585) is identical without audio.
- Complete app failure: the recorded demo campaign pages (`/campaigns/camp_demo_1/*`) are client-seeded and render without any provider or database.
- Refresh mid-demo: completed arena results persist (sessionStorage); Reset clears them.

## Expected outcomes checklist

Three distinct behaviors captured ($574.00 / $616.69 / $645.00) · hidden $45 fee surfaced only after the all-in challenge · negotiation revises $616.69 → $585.00 citing q_budget · comparison shows itemised fees + transcript evidence · recommendation explains rank, not just headline price.
