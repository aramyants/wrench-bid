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
  type NegotiationAsk,
} from "@/lib/wrenchbid/counter-agents";
import { money } from "@/lib/wrenchbid/format";
import { DEMO_CAMPAIGN_ID, DEMO_SESSION_ID } from "@/lib/wrenchbid/seed";
import { useWrenchStore } from "@/lib/wrenchbid/store";

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

const ARENA_STORAGE_KEY = "wrenchbid_arena_v1";

type PersistedArenaState = {
  stage: "quotes_ready" | "complete";
  visibleTurns: Record<string, number>;
  negotiationTurns: number;
};
type VoiceScenario = CounterAgentProfile["id"] | "negotiation";
type SimulationSource = {
  title: string;
  url: string;
  snippet: string;
  score: number;
};
type SimulationStreamEvent =
  | { type: "source"; source: SimulationSource }
  | { type: "turn"; turn: CounterAgentTurn; audioDataUrl: string }
  | { type: "complete"; turnCount: number }
  | { type: "error"; message: string };

const quoteConversations = Object.fromEntries(
  DEMO_COUNTER_AGENTS.map((agent) => [agent.id, buildQuoteConversation(agent)]),
);
const marketScenarios = DEMO_COUNTER_AGENTS.map((agent) => agent.id);
const negotiationAsks = ["beat_or_match", "waive_shop_supply"] satisfies NegotiationAsk[];

const precisionAgent = DEMO_COUNTER_AGENTS.find((agent) => agent.id === "precision")!;
const negotiation = buildNegotiationConversation({
  target: precisionAgent,
  leverageQuoteId: "q_budget",
  leverageShopName: "Budget Brake Center",
  leverageTotal: 574,
  leverageVerified: true,
  asks: negotiationAsks,
});

function AgentArenaPage() {
  const applyNegotiation = useWrenchStore((state) => state.applyNegotiation);
  const [stage, setStage] = useState<ArenaStage>("ready");
  const [visibleTurns, setVisibleTurns] = useState<Record<string, number>>({});
  const [negotiationTurns, setNegotiationTurns] = useState(0);
  const [voiceError, setVoiceError] = useState<string>();
  const [activeScriptedScenario, setActiveScriptedScenario] = useState<VoiceScenario>();
  const [activeScriptedSpeaker, setActiveScriptedSpeaker] = useState<CounterAgentTurn["speaker"]>();
  const [simulationTurns, setSimulationTurns] = useState<CounterAgentTurn[]>([]);
  const [simulationSource, setSimulationSource] = useState<SimulationSource>();
  const [activeSimulationSpeaker, setActiveSimulationSpeaker] =
    useState<CounterAgentTurn["speaker"]>();
  const [simulationComplete, setSimulationComplete] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const runId = useRef(0);
  const scriptedAbortRef = useRef<AbortController | null>(null);
  const simulationAbortRef = useRef<AbortController | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

  function stopActiveAudio() {
    const source = audioSourceRef.current;
    audioSourceRef.current = null;
    if (!source) return;
    try {
      source.stop();
    } catch {
      // The source may already have ended between the ref check and stop call.
    }
  }

  // Completed fixture results survive a browser refresh; only transcripts are
  // restored (never mid-run audio), and Reset clears the saved state.
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(ARENA_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as PersistedArenaState;
      if (saved.stage !== "quotes_ready" && saved.stage !== "complete") return;
      if (saved.stage === "complete") applyNegotiation(negotiationAsks);
      setStage(saved.stage);
      setVisibleTurns(saved.visibleTurns ?? {});
      setNegotiationTurns(saved.negotiationTurns ?? 0);
    } catch {
      // Unreadable saved arena state; the deterministic fixture can simply rerun.
    }
  }, [applyNegotiation]);

  useEffect(() => {
    if (stage !== "quotes_ready" && stage !== "complete") return;
    try {
      window.sessionStorage.setItem(
        ARENA_STORAGE_KEY,
        JSON.stringify({ stage, visibleTurns, negotiationTurns } satisfies PersistedArenaState),
      );
    } catch {
      // Storage can be unavailable (private browsing); results then last one page view.
    }
  }, [stage, visibleTurns, negotiationTurns]);

  useEffect(
    () => () => {
      runId.current += 1;
      window.speechSynthesis?.cancel();
      scriptedAbortRef.current?.abort();
      simulationAbortRef.current?.abort();
      const source = audioSourceRef.current;
      audioSourceRef.current = null;
      try {
        source?.stop();
      } catch {
        // Playback may have ended immediately before unmount.
      }
      void audioContextRef.current?.close();
    },
    [],
  );

  const quoteReady = stage === "quotes_ready" || stage === "negotiating" || stage === "complete";
  const running = stage === "calling" || stage === "negotiating";

  async function prepareAudioContext() {
    const context = audioContextRef.current ?? new AudioContext();
    audioContextRef.current = context;
    await context.resume();
    return context;
  }

  async function fetchScenarioTurnAudio(
    scenario: VoiceScenario,
    turnIndex: number,
    signal: AbortSignal,
  ) {
    const response = await fetch("/api/demo/voice", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario, turnIndex }),
      signal,
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? "ElevenLabs could not generate this turn");
    }
    return response.arrayBuffer();
  }

  async function decodeAudioBuffer(audio: ArrayBuffer, signal?: AbortSignal) {
    const context = audioContextRef.current;
    if (!context) throw new Error("Browser audio could not be initialized");
    if (signal?.aborted) throw new DOMException("Playback cancelled", "AbortError");
    const decoded = await context.decodeAudioData(audio);
    if (signal?.aborted) throw new DOMException("Playback cancelled", "AbortError");
    return decoded;
  }

  async function playDecodedAudio(decoded: AudioBuffer, signal?: AbortSignal) {
    const context = audioContextRef.current;
    if (!context) throw new Error("Browser audio could not be initialized");
    if (signal?.aborted) throw new DOMException("Playback cancelled", "AbortError");
    await new Promise<void>((resolve, reject) => {
      const source = context.createBufferSource();
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", handleAbort);
        if (audioSourceRef.current === source) audioSourceRef.current = null;
        if (error) reject(error);
        else resolve();
      };
      const handleAbort = () => {
        try {
          source.stop();
        } catch {
          // Playback may have finished immediately before cancellation.
        }
        finish(new DOMException("Playback cancelled", "AbortError"));
      };
      audioSourceRef.current = source;
      source.buffer = decoded;
      source.connect(context.destination);
      source.addEventListener("ended", () => finish(), { once: true });
      signal?.addEventListener("abort", handleAbort, { once: true });
      try {
        source.start();
      } catch (error) {
        finish(error instanceof Error ? error : new Error("Audio playback failed"));
      }
    });
  }

  async function playAudioBuffer(audio: ArrayBuffer, signal?: AbortSignal) {
    const decoded = await decodeAudioBuffer(audio, signal);
    await playDecodedAudio(decoded, signal);
  }

  async function playScriptedTurns({
    scenario,
    turns,
    controller,
    currentRun,
    reveal,
  }: {
    scenario: VoiceScenario;
    turns: CounterAgentTurn[];
    controller: AbortController;
    currentRun: number;
    reveal: (visibleCount: number) => void;
  }) {
    setActiveScriptedScenario(scenario);
    for (let index = 0; index < turns.length; index += 1) {
      setActiveScriptedSpeaker(undefined);
      const audio = await fetchScenarioTurnAudio(scenario, index, controller.signal);
      if (controller.signal.aborted || runId.current !== currentRun) return false;
      const decoded = await decodeAudioBuffer(audio, controller.signal);
      if (controller.signal.aborted || runId.current !== currentRun) return false;
      setActiveScriptedSpeaker(turns[index].speaker);
      reveal(index + 1);
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      if (controller.signal.aborted || runId.current !== currentRun) return false;
      await playDecodedAudio(decoded, controller.signal);
    }
    setActiveScriptedSpeaker(undefined);
    return true;
  }

  async function runMarket() {
    stopAgentSimulation();
    scriptedAbortRef.current?.abort();
    stopActiveAudio();
    const currentRun = ++runId.current;
    const controller = new AbortController();
    scriptedAbortRef.current = controller;
    window.speechSynthesis?.cancel();
    setVoiceError(undefined);
    setStage("calling");
    setNegotiationTurns(0);
    setVisibleTurns(Object.fromEntries(DEMO_COUNTER_AGENTS.map((agent) => [agent.id, 0])));
    try {
      await prepareAudioContext();
      for (const scenario of marketScenarios) {
        const completed = await playScriptedTurns({
          scenario,
          turns: quoteConversations[scenario],
          controller,
          currentRun,
          reveal: (visibleCount) =>
            setVisibleTurns((current) => ({ ...current, [scenario]: visibleCount })),
        });
        if (!completed) return;
      }
      if (runId.current === currentRun) setStage("quotes_ready");
    } catch (reason) {
      if (!controller.signal.aborted && runId.current === currentRun) {
        setVisibleTurns(
          Object.fromEntries(
            DEMO_COUNTER_AGENTS.map((agent) => [agent.id, quoteConversations[agent.id].length]),
          ),
        );
        setStage("quotes_ready");
        const message =
          reason instanceof Error ? reason.message : "ElevenLabs call playback failed";
        setVoiceError(`${message}. The complete deterministic transcript is shown instead.`);
      }
    } finally {
      if (scriptedAbortRef.current === controller) scriptedAbortRef.current = null;
      if (runId.current === currentRun) {
        setActiveScriptedScenario(undefined);
        setActiveScriptedSpeaker(undefined);
      }
    }
  }

  async function runCloser() {
    scriptedAbortRef.current?.abort();
    stopActiveAudio();
    const currentRun = ++runId.current;
    const controller = new AbortController();
    scriptedAbortRef.current = controller;
    window.speechSynthesis?.cancel();
    setVoiceError(undefined);
    setStage("negotiating");
    setNegotiationTurns(0);
    try {
      await prepareAudioContext();
      const completed = await playScriptedTurns({
        scenario: "negotiation",
        turns: negotiation.turns,
        controller,
        currentRun,
        reveal: setNegotiationTurns,
      });
      if (completed && runId.current === currentRun) {
        applyNegotiation(negotiationAsks);
        setNegotiationTurns(negotiation.turns.length);
        setStage("complete");
      }
    } catch (reason) {
      if (!controller.signal.aborted && runId.current === currentRun) {
        applyNegotiation(negotiationAsks);
        setNegotiationTurns(negotiation.turns.length);
        setStage("complete");
        const message =
          reason instanceof Error ? reason.message : "ElevenLabs negotiation playback failed";
        setVoiceError(`${message}. The complete deterministic transcript is shown instead.`);
      }
    } finally {
      if (scriptedAbortRef.current === controller) scriptedAbortRef.current = null;
      if (runId.current === currentRun) {
        setActiveScriptedScenario(undefined);
        setActiveScriptedSpeaker(undefined);
      }
    }
  }

  function reset() {
    runId.current += 1;
    scriptedAbortRef.current?.abort();
    scriptedAbortRef.current = null;
    stopActiveAudio();
    window.speechSynthesis?.cancel();
    try {
      window.sessionStorage.removeItem(ARENA_STORAGE_KEY);
    } catch {
      // Nothing to clear when storage is unavailable.
    }
    setStage("ready");
    setVisibleTurns({});
    setNegotiationTurns(0);
    setActiveScriptedScenario(undefined);
    setActiveScriptedSpeaker(undefined);
  }

  function stopAgentSimulation() {
    simulationAbortRef.current?.abort();
    simulationAbortRef.current = null;
    stopActiveAudio();
    setActiveSimulationSpeaker(undefined);
    setSimulating(false);
  }

  async function playStreamedTurn(audioDataUrl: string) {
    const context = audioContextRef.current;
    if (!context) throw new Error("Browser audio could not be initialized");
    const encoded = audioDataUrl.split(",", 2)[1];
    if (!encoded) throw new Error("ElevenLabs returned invalid audio");
    const binary = window.atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    await playAudioBuffer(bytes.buffer, simulationAbortRef.current?.signal);
  }

  async function runAgentSimulation() {
    stopAgentSimulation();
    const controller = new AbortController();
    simulationAbortRef.current = controller;
    setSimulating(true);
    setSimulationTurns([]);
    setSimulationSource(undefined);
    setSimulationComplete(false);
    setVoiceError(undefined);
    try {
      const audioContext = audioContextRef.current ?? new AudioContext();
      audioContextRef.current = audioContext;
      await audioContext.resume();
      const response = await fetch("/api/demo/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error((await response.text()) || "ElevenLabs simulation failed");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;
      while (!finished) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as SimulationStreamEvent;
          if (event.type === "source") {
            setSimulationSource(event.source);
          } else if (event.type === "turn") {
            setActiveSimulationSpeaker(event.turn.speaker);
            setSimulationTurns((current) => [...current, event.turn]);
            await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
            await playStreamedTurn(event.audioDataUrl);
            setActiveSimulationSpeaker(undefined);
          } else if (event.type === "complete") {
            setSimulationComplete(true);
            finished = true;
          } else {
            throw new Error(event.message);
          }
        }
        if (done) finished = true;
      }
    } catch (reason) {
      if (!controller.signal.aborted) {
        setVoiceError(reason instanceof Error ? reason.message : "ElevenLabs simulation failed");
      }
    } finally {
      if (simulationAbortRef.current === controller) simulationAbortRef.current = null;
      setActiveSimulationSpeaker(undefined);
      setSimulating(false);
    }
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
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                The three controlled scenarios run one after another so the voices never overlap.
                They compare hidden-fee, transparent, and evasive shop behavior before a winner is
                negotiated.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <Button
                size="lg"
                variant="secondary"
                onClick={() => (simulating ? stopAgentSimulation() : void runAgentSimulation())}
                disabled={running}
              >
                <Bot className="mr-2 h-4 w-4" />
                {simulating ? "Stop live simulation" : "Start real-time simulation"}
              </Button>
              {stage === "ready" ? (
                <Button
                  size="lg"
                  onClick={() => void runMarket()}
                  className="bg-lime text-lime-foreground shadow-[0_0_28px_-8px_oklch(0.88_0.20_128)] hover:brightness-95"
                >
                  <PhoneCall className="mr-2 h-4 w-4" /> Run 3 voiced scenarios
                </Button>
              ) : (
                <Button size="lg" variant="secondary" onClick={reset}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  {running ? "Stop and reset" : "Reset arena"}
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

      {(simulating || simulationTurns.length > 0 || simulationSource) && (
        <section className="mt-5 rounded-2xl border border-[color:var(--cobalt)]/30 bg-[color:var(--cobalt)]/5 p-5 lg:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mono text-[10px] uppercase tracking-widest text-[color:var(--cobalt)]">
                ElevenLabs agent simulation
              </div>
              <h2 className="mt-2 text-2xl font-semibold">Buyer agent {"\u2194"} AI repair shop</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Each message appears as its voice begins. The next agent waits until the current
                speaker finishes. No phone number is dialed.
              </p>
            </div>
            {simulating ? (
              <LiveIndicator
                label={
                  activeSimulationSpeaker ? `${activeSimulationSpeaker} speaking` : "connecting"
                }
              />
            ) : simulationComplete ? (
              <Pill tone="verified">Simulation complete</Pill>
            ) : null}
          </div>

          {simulationSource && (
            <a
              href={simulationSource.url}
              target="_blank"
              rel="noreferrer"
              className="group mt-5 block rounded-xl border border-lime/20 bg-lime/5 p-4 transition hover:border-lime/50 hover:bg-lime/10"
            >
              <div className="mono text-[9px] uppercase tracking-[0.18em] text-lime">
                Live Tavily source {"\u00b7"} public business data
              </div>
              <div className="mt-2 flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-medium text-foreground group-hover:text-lime">
                    {simulationSource.title}
                  </h3>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                    {simulationSource.snippet}
                  </p>
                </div>
                <ArrowRight className="mt-1 h-4 w-4 shrink-0 -rotate-45 text-lime" />
              </div>
              <p className="mt-3 text-[11px] text-amber">
                Business context is sourced. Quote prices remain controlled simulation data.
              </p>
            </a>
          )}

          <div
            className="mt-5 space-y-3 rounded-xl border border-border bg-background/70 p-4"
            aria-live="polite"
          >
            {simulationTurns.map((turn) => (
              <motion.div
                key={turn.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={
                  activeSimulationSpeaker === turn.speaker && simulationTurns.at(-1)?.id === turn.id
                    ? "rounded-lg ring-1 ring-lime/40"
                    : undefined
                }
              >
                <TranscriptTurn turn={turn} />
              </motion.div>
            ))}
            {simulating && simulationTurns.length === 0 && (
              <EmptyTranscript text="Finding a Tavily source and connecting the agents..." />
            )}
            {simulating && simulationTurns.length > 0 && !activeSimulationSpeaker && (
              <EmptyTranscript text="The other agent is preparing a response..." />
            )}
          </div>
        </section>
      )}

      <section className="mt-5 grid gap-4 xl:grid-cols-3">
        {DEMO_COUNTER_AGENTS.map((agent, index) => (
          <CounterLane
            key={agent.id}
            agent={agent}
            number={index + 1}
            turns={quoteConversations[agent.id]}
            visibleCount={visibleTurns[agent.id] ?? 0}
            active={stage === "calling" && activeScriptedScenario === agent.id}
            activeSpeaker={activeScriptedScenario === agent.id ? activeScriptedSpeaker : undefined}
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
                all-in offer from another shop. This second conversation tests whether that verified
                leverage changes the price; every turn is voiced as it appears.
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
                  <CircleDollarSign className="mr-2 h-4 w-4" /> Start voiced negotiation
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
                {stage === "negotiating" && (
                  <LiveIndicator
                    label={
                      activeScriptedSpeaker
                        ? `${activeScriptedSpeaker === "wrenchbid" ? "buyer" : "shop"} speaking`
                        : "preparing next turn"
                    }
                  />
                )}
                {stage === "complete" && <Pill tone="verified">Revised to $585</Pill>}
              </div>
              <div className="mt-4 space-y-3">
                {negotiation.turns.slice(0, negotiationTurns).map((item) => (
                  <TranscriptTurn key={item.id} turn={item} />
                ))}
                {stage === "quotes_ready" && (
                  <EmptyTranscript text="Start the voiced leverage round to test the best verified quote." />
                )}
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {voiceError && (
        <p
          role="alert"
          aria-live="assertive"
          className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {voiceError}
        </p>
      )}

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
  active,
  activeSpeaker,
}: {
  agent: CounterAgentProfile;
  number: number;
  turns: CounterAgentTurn[];
  visibleCount: number;
  active: boolean;
  activeSpeaker?: CounterAgentTurn["speaker"];
}) {
  const visible = useMemo(() => turns.slice(0, visibleCount), [turns, visibleCount]);
  const captured = visibleCount === turns.length && turns.length > 0;
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
          {active && visibleCount < turns.length ? (
            <LiveIndicator
              label={
                activeSpeaker
                  ? `${activeSpeaker === "wrenchbid" ? "buyer" : "shop"} speaking`
                  : "preparing next turn"
              }
            />
          ) : captured ? (
            <Pill tone="verified">Captured</Pill>
          ) : (
            <Pill tone="muted">Ready</Pill>
          )}
        </div>
      </header>
      <div className="flex-1 p-4">
        <div className="space-y-3" aria-live="polite">
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
              {captured ? money(agent.quote.total) : "—"}
            </div>
          </div>
          {captured && <Pill tone="verified">Voiced turn by turn</Pill>}
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
