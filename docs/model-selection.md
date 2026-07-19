# Model selection

Every model identifier is configuration, not code. Defaults live in `src/lib/wrenchbid/server/env.server.ts`; override any of them in `.env.local` without touching source.

| Task | Component | Default | Env var | Why |
| --- | --- | --- | --- | --- |
| Real-time voice intake (STT + reasoning + TTS) | ElevenLabs Conversational AI agent (WebRTC) | Configured per-agent in the ElevenLabs dashboard | `ELEVENLABS_INTAKE_AGENT_ID` | Full-duplex latency and barge-in are handled by the agent platform; the app only issues short-lived conversation tokens server-side |
| Per-turn speech synthesis (arena, voiced intake replay) | `text-to-speech` | `eleven_flash_v2_5` | `ELEVENLABS_TTS_MODEL_ID` | Lowest-latency ElevenLabs TTS tier; per-turn generation must not stall the conversation rhythm |
| Whole-conversation dialogue synthesis | `text-to-dialogue` | `eleven_v3` | `ELEVENLABS_DIALOGUE_MODEL_ID` | Highest-expressiveness model; acceptable because it renders a complete scripted exchange, not a live turn |
| Live conversational reasoning (simulated shop counterpart) | agent `simulate-conversation/stream` LLM | `gemini-3.5-flash` | `ELEVENLABS_SIMULATION_LLM` | Fast/cheap tier keeps simulated turns near-realtime; measured run: first turn 0.6s, full 7-turn negotiation 12.6s (see `docs/VERIFICATION.md`) |
| Document extraction | PDF.js text layer + deterministic rules | n/a (no LLM) | n/a | Zero-hallucination intake: every proposed field carries a source excerpt and confidence, and wrong proposals are correctable before confirmation. An LLM/OCR path is a documented limitation, not a hidden fallback |
| Quote normalization, ranking, money | Deterministic TypeScript | n/a | n/a | Release gate requires 100% deterministic money arithmetic; done in integer cents |
| Automated evaluation | Vitest over golden calls | n/a | n/a | Offline, deterministic, free; runs the exact production pipeline modules |

## Measured evidence and honest gaps

- Measured: the streamed simulation timeline above; TTS/dialogue generation verified against the real API (MP3 responses with sizes recorded in `docs/VERIFICATION.md`); 76 eval assertions on extraction/evidence/outcome quality.
- Not measured: head-to-head latency or extraction-accuracy comparison across alternative ElevenLabs models or agent LLMs. Reason: comparisons require paid live calls per candidate configuration; no credential budget was available in this environment. The configuration surface exists precisely so that comparison is a config sweep, not a code change. Until then, no model here is claimed "best" — defaults are the platform's low-latency tiers for real-time tasks and the expressive tier for offline rendering.
