import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Bot,
  Check,
  CircleDollarSign,
  Database,
  FileCheck2,
  PhoneCall,
  Play,
  RotateCcw,
  ShieldCheck,
  Volume2,
} from "lucide-react";
import { AppShell } from "@/components/wrenchbid/AppShell";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/wrenchbid/StatusPill";
import {
  buildNegotiationConversation,
  buildQuoteConversation,
  DEMO_COUNTER_AGENTS,
  DEMO_REPAIR_SPEC_SUMMARY,
  type CounterAgentProfile,
  type CounterAgentTurn,
} from "@/lib/wrenchbid/counter-agents";
import { money } from "@/lib/wrenchbid/format";
import { DEMO_CAMPAIGN_ID, DEMO_SESSION_ID } from "@/lib/wrenchbid/seed";

export const Route = createFileRoute("/demo/arena")({
  head: () => ({
    meta: [
      { title: "Agent Arena — WrenchBid" },
      {
        name: "description",
        content:
          "See WrenchBid negotiate against three rule-driven Counter Agents using one confirmed repair scope.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AgentArenaPage,
});

type ArenaStage = "ready" | "calling" | "quotes_ready" | "negotiating" | "complete";

const quoteConversations = Object.fromEntries(
  DEMO_COUNTER_AGENTS.map((agent) => [agent.id, buildQuoteConversation(agent)]),
);

const precisionAgent = DEMO_COUNTER_AGENTS.find((agent) => agent.id === "precision")!;
const negotiation = buildNegotiationConversation({
  target: precisionAgent,
  leverageQuoteId: "q_budget",
  leverageShopName: "Budget Brake Center",
  leverageTotal: 574,
  leverageVerified: true,
  asks: ["beat_or_match", "waive_shop_supply"],
});

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function AgentArenaPage() {
  const [stage, setStage] = useState<ArenaStage>("ready");
  const [visibleTurns, setVisibleTurns] = useState<Record<string, number>>({});
  const [negotiationTurns, setNegotiationTurns] = useState(0);
  const runId = useRef(0);

  useEffect(
    () => () => {
      runId.current += 1;
      window.speechSynthesis?.cancel();
    },
    [],
  );

  const quoteReady = stage === "quotes_ready" || stage === "negotiating" || stage === "complete";
  const running = stage === "calling" || stage === "negotiating";

  async function runMarket() {
    const currentRun = ++runId.current;
    window.speechSynthesis?.cancel();
    setStage("calling");
    setNegotiationTurns(0);
    setVisibleTurns(Object.fromEntries(DEMO_COUNTER_AGENTS.map((agent) => [agent.id, 0])));
    const longestConversation = Math.max(
      ...DEMO_COUNTER_AGENTS.map((agent) => quoteConversations[agent.id].length),
    );
    for (let index = 1; index <= longestConversation; index += 1) {
      await wait(430);
      if (runId.current !== currentRun) return;
      setVisibleTurns(
        Object.fromEntries(
          DEMO_COUNTER_AGENTS.map((agent) => [
            agent.id,
            Math.min(index, quoteConversations[agent.id].length),
          ]),
        ),
      );
    }
    if (runId.current === currentRun) setStage("quotes_ready");
  }

  async function runCloser() {
    const currentRun = ++runId.current;
    window.speechSynthesis?.cancel();
    setStage("negotiating");
    setNegotiationTurns(0);
    for (let index = 1; index <= negotiation.turns.length; index += 1) {
      await wait(620);
      if (runId.current !== currentRun) return;
      setNegotiationTurns(index);
    }
    if (runId.current === currentRun) setStage("complete");
  }

  function reset() {
    runId.current += 1;
    window.speechSynthesis?.cancel();
    setStage("ready");
    setVisibleTurns({});
    setNegotiationTurns(0);
  }

  return (
    <AppShell>
      <section className="relative overflow-hidden rounded-2xl border border-lime/20 bg-[radial-gradient(circle_at_20%_0%,oklch(0.88_0.20_128/0.10),transparent_34%),linear-gradient(145deg,oklch(0.16_0.015_250/0.96),oklch(0.09_0.012_250/0.98))] p-5 shadow-2xl md:p-8">
        <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:linear-gradient(oklch(0.88_0.20_128/0.12)_1px,transparent_1px),linear-gradient(90deg,oklch(0.88_0.20_128/0.12)_1px,transparent_1px)] [background-size:44px_44px]" />
        <div className="relative">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="mono flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-lime">
              <span className="inline-flex h-2 w-2 rounded-full bg-lime shadow-[0_0_16px_oklch(0.88_0.20_128)]" />
              Agent Arena · controlled market
            </div>
            <Pill tone="amber">Synthetic counterparties · no business called</Pill>
          </div>

          <div className="mt-7 grid items-end gap-6 lg:grid-cols-[1fr_auto]">
            <div>
              <h1 className="max-w-4xl text-4xl font-semibold leading-[0.98] tracking-[-0.045em] md:text-6xl">
                One buyer agent.
                <br />
                <span className="text-lime">Three different opponents.</span>
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
                WrenchBid gives every Counter Agent the same confirmed repair scope. Private pricing
                policies create real friction; only the spoken, itemized result reaches the buyer.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 lg:justify-end">
              {stage === "ready" ? (
                <Button
                  size="lg"
                  onClick={() => void runMarket()}
                  className="bg-lime text-lime-foreground shadow-[0_0_28px_-8px_oklch(0.88_0.20_128)] hover:brightness-95"
                >
                  <PhoneCall className="mr-2 h-4 w-4" /> Run three calls
                </Button>
              ) : (
                <Button size="lg" variant="secondary" onClick={reset} disabled={running}>
                  <RotateCcw className="mr-2 h-4 w-4" /> Reset arena
                </Button>
              )}
            </div>
          </div>

          <SignalFlow active={running} />
        </div>
      </section>

      <section className="mt-5 rounded-xl border border-border bg-surface/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Confirmed RepairSpec · identical input to every call
            </div>
            <p className="mt-2 max-w-5xl text-sm leading-relaxed text-foreground">
              {DEMO_REPAIR_SPEC_SUMMARY}.
            </p>
          </div>
          <Link
            to="/requests/$id/extraction"
            params={{ id: DEMO_SESSION_ID }}
            className="mono text-xs uppercase tracking-wider text-lime hover:underline"
          >
            Inspect source
          </Link>
        </div>
      </section>

      <section className="mt-5 grid gap-4 xl:grid-cols-3">
        {DEMO_COUNTER_AGENTS.map((agent, index) => (
          <CounterLane
            key={agent.id}
            agent={agent}
            number={index + 1}
            turns={quoteConversations[agent.id]}
            visibleCount={visibleTurns[agent.id] ?? 0}
            quoteReady={quoteReady}
            calling={stage === "calling"}
          />
        ))}
      </section>

      <AnimatePresence>
        {quoteReady && (
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-5 grid gap-4 rounded-2xl border border-[color:var(--cobalt)]/30 bg-[color:var(--cobalt)]/5 p-5 lg:grid-cols-[0.8fr_1.2fr] lg:p-7"
          >
            <div>
              <div className="mono text-[10px] uppercase tracking-widest text-[color:var(--cobalt)]">
                Closer round · genuine leverage only
              </div>
              <h2 className="mt-2 text-2xl font-semibold">Can Precision improve $616.69?</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                WrenchBid may cite only stored quote{" "}
                <span className="mono text-foreground">q_budget</span>: a transcript-confirmed $574
                all-in offer from another shop.
              </p>
              <div className="mt-5 grid grid-cols-3 gap-2">
                <Metric label="Before" value={money(negotiation.before)} />
                <Metric label="Leverage" value={money(574)} />
                <Metric
                  label={stage === "complete" ? "Revised" : "Result"}
                  value={stage === "complete" ? money(negotiation.after) : "—"}
                  accent={stage === "complete"}
                />
              </div>
              {stage === "quotes_ready" && (
                <Button
                  className="mt-5 bg-lime text-lime-foreground"
                  onClick={() => void runCloser()}
                >
                  <CircleDollarSign className="mr-2 h-4 w-4" /> Run leverage negotiation
                </Button>
              )}
              {stage === "complete" && (
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <Pill tone="verified" icon={<Check className="h-3 w-3" />}>
                    {money(negotiation.savings)} lower because of stored leverage
                  </Pill>
                  <Link
                    to="/campaigns/$id/compare"
                    params={{ id: DEMO_CAMPAIGN_ID }}
                    className="inline-flex items-center text-sm text-lime hover:underline"
                  >
                    Open full comparison <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Link>
                </div>
              )}
            </div>
            <div className="min-h-80 rounded-xl border border-border bg-background/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Negotiator ↔ Precision Counter Agent
                </div>
                {stage === "negotiating" && <LiveIndicator label="negotiating" />}
                {stage === "complete" && <Pill tone="verified">Revised to $585</Pill>}
              </div>
              <div className="mt-4 space-y-3">
                {negotiation.turns.slice(0, negotiationTurns).map((item) => (
                  <TranscriptTurn key={item.id} turn={item} />
                ))}
                {stage === "quotes_ready" && (
                  <EmptyTranscript text="Approve the leverage round to start the second conversation." />
                )}
              </div>
              {stage === "complete" && (
                <button
                  type="button"
                  onClick={() => speakConversation(negotiation.turns)}
                  className="mono mt-4 inline-flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-lime"
                >
                  <Volume2 className="h-3.5 w-3.5" /> Play device-voice preview
                </button>
              )}
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <section className="mt-5">
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <div className="mono text-[10px] uppercase tracking-widest text-lime">
              Data provenance · what is real vs simulated
            </div>
            <h2 className="mt-1 text-2xl font-semibold">Every number has an origin</h2>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <ProvenanceCard
            icon={<FileCheck2 className="h-4 w-4" />}
            title="Repair scope"
            demo="Synthetic Camry estimate + confirmed corrections"
            live="Uploaded PDF / voice interview / user confirmation"
          />
          <ProvenanceCard
            icon={<Bot className="h-4 w-4" />}
            title="Counterparties"
            demo="Three private rule-driven shop policies"
            live="Tavily leads or manually verified businesses"
          />
          <ProvenanceCard
            icon={<Database className="h-4 w-4" />}
            title="Prices & evidence"
            demo="Counter policy → spoken turn → normalized quote"
            live="ElevenLabs transcript + structured post-call fields"
          />
          <ProvenanceCard
            icon={<ShieldCheck className="h-4 w-4" />}
            title="Benchmark"
            demo="Median of complete comparable captured quotes"
            live="Same today; licensed external pricing is not connected"
          />
        </div>
      </section>
    </AppShell>
  );
}

function SignalFlow({ active }: { active: boolean }) {
  return (
    <div className="mt-8 grid items-center gap-3 md:grid-cols-[1fr_minmax(90px,0.45fr)_1fr_minmax(90px,0.45fr)_1fr]">
      <SignalNode
        icon={<Bot className="h-5 w-5" />}
        label="WrenchBid"
        detail="buyer agent"
        active={active}
      />
      <SignalLine active={active} label="same spec" />
      <SignalNode
        icon={<PhoneCall className="h-5 w-5" />}
        label="Agent channel"
        detail="controlled call"
        active={active}
      />
      <SignalLine active={active} label="spoken quote" />
      <SignalNode
        icon={<Bot className="h-5 w-5" />}
        label="Counter Agent"
        detail="private policy"
        active={active}
      />
    </div>
  );
}

function SignalNode({
  icon,
  label,
  detail,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
  active: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-background/70 p-3">
      <span
        className={`rounded-md p-2 ${active ? "bg-lime text-lime-foreground" : "bg-secondary text-muted-foreground"}`}
      >
        {icon}
      </span>
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="mono text-[9px] uppercase tracking-wider text-muted-foreground">
          {detail}
        </div>
      </div>
    </div>
  );
}

function SignalLine({ active, label }: { active: boolean; label: string }) {
  return (
    <div className="hidden md:block">
      <div className="relative h-px bg-border">
        {active && (
          <motion.span
            className="absolute -top-1 h-2 w-2 rounded-full bg-lime shadow-[0_0_12px_oklch(0.88_0.20_128)]"
            animate={{ left: ["0%", "100%"] }}
            transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }}
          />
        )}
      </div>
      <div className="mono mt-2 text-center text-[8px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function CounterLane({
  agent,
  number,
  turns,
  visibleCount,
  quoteReady,
  calling,
}: {
  agent: CounterAgentProfile;
  number: number;
  turns: CounterAgentTurn[];
  visibleCount: number;
  quoteReady: boolean;
  calling: boolean;
}) {
  const visible = useMemo(() => turns.slice(0, visibleCount), [turns, visibleCount]);
  return (
    <article className="flex min-h-[34rem] flex-col overflow-hidden rounded-xl border border-border bg-surface/70">
      <header className="border-b border-border p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
              Counter {String(number).padStart(2, "0")}
            </div>
            <h2 className="mt-1 text-lg font-semibold">{agent.shopName}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{agent.publicStyle}</p>
          </div>
          {calling && visibleCount < turns.length ? (
            <LiveIndicator label="on call" />
          ) : quoteReady ? (
            <Pill tone="verified">Captured</Pill>
          ) : (
            <Pill tone="muted">Ready</Pill>
          )}
        </div>
      </header>
      <div className="flex-1 p-4">
        <div className="space-y-3">
          {visible.map((item) => (
            <TranscriptTurn key={item.id} turn={item} />
          ))}
          {visible.length === 0 && (
            <EmptyTranscript text="Waiting for the buyer agent to start this call." />
          )}
        </div>
      </div>
      <footer className="border-t border-border bg-background/40 p-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="mono text-[9px] uppercase tracking-widest text-muted-foreground">
              All-in result
            </div>
            <div className="mono mt-1 text-2xl font-semibold text-lime">
              {quoteReady ? money(agent.quote.total) : "—"}
            </div>
          </div>
          {quoteReady && (
            <button
              type="button"
              onClick={() => speakConversation(turns)}
              className="mono inline-flex items-center gap-2 text-[9px] uppercase tracking-widest text-muted-foreground hover:text-lime"
            >
              <Volume2 className="h-3.5 w-3.5" /> Voice preview
            </button>
          )}
        </div>
        <details className="mt-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none hover:text-foreground">
            Demo-only private policy
          </summary>
          <p className="mt-2 leading-relaxed">{agent.privatePolicy.summary}</p>
          <p className="mt-1 leading-relaxed">{agent.privatePolicy.concessionRule}</p>
        </details>
      </footer>
    </article>
  );
}

function TranscriptTurn({ turn }: { turn: CounterAgentTurn }) {
  const buyer = turn.speaker === "wrenchbid";
  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-lg border p-3 ${buyer ? "ml-5 border-[color:var(--cobalt)]/30 bg-[color:var(--cobalt)]/8" : "mr-5 border-border bg-background/70"}`}
    >
      <div
        className={`mono text-[8px] uppercase tracking-widest ${buyer ? "text-[color:var(--cobalt)]" : "text-lime"}`}
      >
        {buyer ? "WrenchBid" : "Counter Agent"}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-foreground/90">{turn.text}</p>
      {turn.evidenceFields && (
        <div className="mono mt-2 text-[8px] uppercase tracking-wider text-verified">
          evidence · {turn.evidenceFields.join(" · ")}
        </div>
      )}
    </motion.div>
  );
}

function EmptyTranscript({ text }: { text: string }) {
  return (
    <div className="grid min-h-28 place-items-center rounded-lg border border-dashed border-border px-5 text-center">
      <div>
        <Play className="mx-auto h-4 w-4 text-muted-foreground" />
        <p className="mt-2 text-xs text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}

function LiveIndicator({ label }: { label: string }) {
  return (
    <span className="mono inline-flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-lime">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-lime" /> {label}
    </span>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className={`rounded-lg border p-3 ${accent ? "border-lime/40 bg-lime/5" : "border-border bg-background/50"}`}
    >
      <div className="mono text-[8px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div
        className={`mono mt-1 text-lg font-semibold ${accent ? "text-lime" : "text-foreground"}`}
      >
        {value}
      </div>
    </div>
  );
}

function ProvenanceCard({
  icon,
  title,
  demo,
  live,
}: {
  icon: React.ReactNode;
  title: string;
  demo: string;
  live: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface/60 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <span className="text-lime">{icon}</span> {title}
      </div>
      <dl className="mt-3 space-y-3 text-xs leading-relaxed">
        <div>
          <dt className="mono text-[8px] uppercase tracking-widest text-amber">This demo</dt>
          <dd className="mt-1 text-muted-foreground">{demo}</dd>
        </div>
        <div>
          <dt className="mono text-[8px] uppercase tracking-widest text-verified">Live product</dt>
          <dd className="mt-1 text-muted-foreground">{live}</dd>
        </div>
      </dl>
    </div>
  );
}

function speakConversation(turns: CounterAgentTurn[]) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const voices = window.speechSynthesis.getVoices();
  for (const item of turns) {
    const utterance = new SpeechSynthesisUtterance(item.text);
    utterance.rate = item.speaker === "wrenchbid" ? 1.04 : 0.98;
    utterance.pitch = item.speaker === "wrenchbid" ? 1.08 : 0.92;
    utterance.voice =
      voices.find((voice) => voice.lang.startsWith("en") && voice.name.includes("Microsoft")) ??
      voices.find((voice) => voice.lang.startsWith("en")) ??
      null;
    window.speechSynthesis.speak(utterance);
  }
}
