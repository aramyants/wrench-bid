# Golden-call eval suite — design

Date: 2026-07-19
Status: implemented in this change

## Problem

The challenge brief ("Golden calls & eval sets") and `docs/AGENT_HANDOFF.md` (task 3)
require a repeatable evaluation suite that answers, with evidence:

1. Does the pipeline extract **every fee** from a call, itemised?
2. Does ranking catch the **30%-below-market** red flag (and only then)?
3. Do **honesty constraints** hold: AI disclosure when asked, no invented
   competing bid, no price movement without genuine stored leverage?
4. Does **every call end in exactly one structured outcome**?

Today those behaviours live partly in unit tests and partly inside
`src/lib/wrenchbid/server/elevenlabs-webhook.server.ts`, where the transcript
normalisation, fee extraction, completeness/warning computation, and outcome
inference are private functions interleaved with SQL. Nothing can run a golden
transcript through the *real* pipeline without a database.

## Decision

**Extract, don't duplicate.** Move the pure normalisation logic into a shared
module, `src/lib/wrenchbid/call-normalization.ts`, and make the webhook consume
it. The eval suite then exercises the exact code the production webhook runs.
Behaviour must not change; the existing tests and the webhook SQL flow stay
as they are.

Alternatives rejected:

- *Re-implement extraction inside the eval suite* — the eval would drift from
  production and prove nothing.
- *Eval through the webhook with a test database* — heavier, slower, and the
  properties under eval (extraction, flags, honesty, outcomes) are pure.

## Components

1. `src/lib/wrenchbid/call-normalization.ts` — pure functions moved verbatim
   from the webhook module: `normalizeTranscript`, `extractDataCollection`
   (was `collection`), `inferOutcome`, value coercers, plus `normalizeQuote`
   (the pre-SQL half of `persistQuote`: fields, items, subtotal, completeness,
   status, transcript-evidence matches, `confirmedInCall`, warnings).
2. `src/lib/wrenchbid/evals/golden-calls/*.json` — golden call fixtures in the
   ElevenLabs `post_call_transcription` shape (`transcript`,
   `analysis.data_collection_results`) plus an `expected` block. Coverage:
   the three counterparty styles (transparent, hidden-fees, evasive), and
   friction cases: "are you a robot?", refusal to quote, callback commitment,
   a hallucinated total the shop never said, and a headline-only
   non-comparable quote.
3. `src/lib/wrenchbid/evals/golden-call-fixtures.ts` — zod-validated fixture
   loader, so a malformed fixture fails loudly instead of passing vacuously.
4. `src/lib/wrenchbid/evals/golden-calls.eval.test.ts` — the suite, runnable
   via `npm run eval` and included in `npm test`/CI:
   - **Fee extraction:** every expected fee is itemised with the right amount;
     completeness, status, `confirmedInCall`, and warnings match exactly.
   - **Evidence:** each expected field is backed by a shop-turn evidence span;
     a collected total the shop never voiced must *not* be confirmed.
   - **Outcomes:** `inferOutcome` maps each golden call to its expected
     terminal outcome.
   - **Honesty:** any robot/AI question from the shop is followed by an agent
     turn that discloses AI; no agent turn ever claims to be human.
   - **Red flags:** `rankQuotes` boundary tests (exactly 0.7× median is not
     flagged, below is; 1.5× likewise) and an end-to-end market check built
     from the golden quotes, including exclusion of unconfirmed totals from
     the benchmark.
   - **Negotiation gating:** price moves only with verified, cheaper, stored
     leverage and an approved price ask; without leverage the agent says so
     and never cites a stored quote.
5. `docs/EVALS.md` — how to run, what each category proves, how to add a
   golden call; explicit note that this suite is offline and does not replace
   live role-play calls.
6. `package.json` — `"eval": "vitest run src/lib/wrenchbid/evals"`.

## Non-goals

- No live-call or LLM-judged evals; the suite is deterministic and offline.
- No new benchmark data source (AGENT_HANDOFF task 5 stays open).
- No behaviour change in webhook processing, ranking, or evidence matching.
