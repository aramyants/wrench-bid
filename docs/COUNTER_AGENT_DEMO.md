# Counter Agent demo

## What `/demo/arena` is

`/demo/arena` is a deterministic, synthetic agent-to-agent presentation against three rule-driven Counter Agent profiles. It does not dial a phone number, contact a real business, or persist quotes to the production database.

**Run 3 voiced scenarios** and **Start voiced negotiation** request fixed turns from the server one at a time. ElevenLabs generates each turn with distinct buyer/shop voices; the browser reveals the message as playback begins and waits for it to finish before requesting the response. This is provider TTS over controlled content, not a phone call or full-duplex Conversational AI session.

The arena exists to demonstrate the product logic reliably:

- one confirmed RepairSpec is reused for every counterparty;
- three private policies produce distinct, unscripted-by-the-presenter behaviors;
- every final total is spoken explicitly and associated with evidence fields;
- negotiation cites only a stored, verified competing quote;
- the outcome changes because the target's private concession rule accepts that leverage.

The implementation is in `src/lib/wrenchbid/counter-agents.ts` and `src/routes/demo.arena.tsx`. It is a self-contained fixture: running it does not persist quotes or modify the production database.

The arena also offers an optional **Start real-time simulation** action. It resolves a live Tavily
repair-shop source, runs the configured WrenchBid caller through ElevenLabs' streaming conversation
simulator against an LLM-driven shop counterpart, synthesizes each turn independently, and sends
newline-delimited events to the browser. The browser reveals a message as its audio starts and waits
for playback to finish before revealing the response. It does not dial a number or create a PSTN
call. The linked Tavily result supports only public business context; displayed prices remain
explicitly labeled controlled simulation data.

## Demo data and provenance

| Data                 | Controlled arena                                               | Live product path                                                                     |
| -------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Repair scope         | Synthetic 2020 Camry brake estimate plus confirmed corrections | Uploaded text PDF, voice intake, and explicit user corrections/confirmation           |
| Counterparties       | Three synthetic Counter Agent profiles                         | Tavily leads or businesses added and phone-verified manually                          |
| Quote evidence       | Rule-generated spoken turns and declared evidence fields       | ElevenLabs post-call transcript plus structured collection fields                     |
| Comparison benchmark | Median of complete, comparable captured quotes                 | The same campaign median; a licensed external repair-price benchmark is not connected |

The supplied project brief is presentation guidance, not a source of customer, shop, or price data.

## How the Counter Agent works

Each synthetic shop has a public style, exact quote terms, and a policy that is private from the buyer-agent logic. The page exposes the policy in a presenter-only details panel so reviewers can understand why the behavior differs.

- **Budget Brake Center** leads with a low headline and reveals its shop fee only after a direct all-in question.
- **Precision Auto Works** itemizes immediately and protects a premium warranty.
- **Queen City Garage** starts with a range and inspection condition, then gives a firm itemization when the buyer repeats the sealed scope.

The buyer receives only conversation turns and spoken terms. It does not inspect the Counter Agent policy. This separation is what makes the interaction rule-driven instead of two agents reading the same prerecorded transcript.

The closer round targets Precision's original **$616.69** quote. It cites stored quote `q_budget`, a transcript-confirmed **$574.00 all-in** quote, and asks Precision to approach the price and waive its shop-supply fee. The Counter Agent's private floor is **$585.00**, so it preserves the warranty and returns a revised **$585.00 all-in** total. The engine will not claim or accept leverage unless the competing quote has an ID, is marked verified, and is genuinely below the target quote.

## Presenter runbook

1. Open `http://localhost:3000/demo/arena`.
2. Point out the **Synthetic counterparties - no business called** label.
3. Show the single confirmed RepairSpec; every lane receives that exact scope.
4. Select **Run 3 voiced scenarios** and compare the hidden-fee, transparent, and evasive behaviors. They run sequentially so the three conversations never speak over one another.
5. Confirm that every lane ends with a spoken all-in total, warranty, appointment, and quote-validity term.
6. Explain that the policy details are presenter aids and are not given to the WrenchBid buyer agent.
7. Select **Start voiced negotiation**.
8. Trace the evidence: stored `q_budget` at $574.00, Precision before at $616.69, revised result at $585.00.
9. Open the full comparison to continue the recorded end-to-end workflow.

Resetting and rerunning produces the same business outcome by design, which makes the arena suitable for a stable product presentation and regression testing.

## Recommended true live architecture

For a judged live voice demo, keep the same policies but place each side on a real provider conversation owned by the operator:

```text
WrenchBid caller agent
        |
        | outbound ElevenLabs call
        v
owned Twilio/SIP destination
        |
        | inbound route
        v
Counter Agent with private shop profile + deterministic pricing tool
```

Use one inbound Counter Agent with three selected profiles or three equivalent inbound agents/numbers. The target must be an operator-owned role-play destination, not an unsuspecting business. Give the Counter Agent its profile and price/concession state privately; give the caller only the confirmed RepairSpec, required quote fields, and honesty rules. Ensure one side clearly initiates the exchange so two agents do not talk over each other at connection time.

Map only the caller-side post-call webhook into WrenchBid. Counter-side events should use a separate test sink or be ignored, otherwise the same conversation can create duplicate or unmapped quote events. The existing application consumes completed ElevenLabs transcripts and structured fields after the call; it does not currently stream a live transcript to the page.

Before any provider-backed run:

- rotate exposed credentials and configure them only as server-side secrets;
- use owned Twilio/SIP destinations and explicit operator authorization;
- confirm recording-consent requirements;
- configure the structured fields and signed webhook described in `docs/INTEGRATIONS.md`;
- keep the local arena as the fallback if telephony or webhook delivery fails.

## Known limitations

- The three comparison scenarios and evidence-bound negotiation exercise provider TTS turn by
  turn. They do not exercise live call transport, interruption, barge-in, voicemail, or full-duplex
  Conversational AI behavior.
- The optional AI simulation exercises the configured caller prompt, incremental provider turns,
  per-turn voice generation, and Tavily provenance, but remains a provider simulation rather than
  a live full-duplex audio transport.
- The arena's quote conversations are generated in memory and are not database records.
- Voiced playback requires a configured `ELEVENLABS_API_KEY`; the server accepts only fixed arena
  scenarios and valid turn indices, and rate-limits generation.
- The live product uses post-call evidence, so a provider call can remain pending until its verified webhook arrives.
- The campaign median is the only current pricing benchmark; do not present it as market-wide repair-price data.
