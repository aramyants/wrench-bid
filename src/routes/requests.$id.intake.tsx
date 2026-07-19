import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/wrenchbid/AppShell";
import { DEMO_INTAKE_TURNS, type DemoIntakeTurn } from "@/lib/wrenchbid/demo-intake";
import { useWrenchStore } from "@/lib/wrenchbid/store";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, PhoneOff, ArrowRight, CheckCircle2, Circle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Pill } from "@/components/wrenchbid/StatusPill";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { getVoiceToken, registerVoiceConversation, updateRepairSpec } from "@/lib/wrenchbid/api";
import { useRequestSync } from "@/hooks/use-live-sync";
import type { RepairSpec } from "@/lib/wrenchbid/types";

export const Route = createFileRoute("/requests/$id/intake")({
  head: () => ({
    meta: [{ title: "Voice intake — WrenchBid" }, { name: "robots", content: "noindex" }],
  }),
  component: IntakePage,
});

type Turn = { role: "agent" | "customer"; text: string; at: number };

const NUMERIC_REPAIR_SPEC_PATHS = new Set(["vehicle.year", "vehicle.mileage", "completionByDays"]);

async function fetchDemoIntakeAudio(turnIndex: number, signal: AbortSignal) {
  const response = await fetch("/api/demo/intake-voice", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ turnIndex }),
    signal,
  });
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(message || `The intake voice failed (${response.status})`);
  }
  return response.arrayBuffer();
}

function coerceRepairSpecToolValue(path: string, value: unknown) {
  if (NUMERIC_REPAIR_SPEC_PATHS.has(path)) {
    const normalized = typeof value === "string" ? value.replaceAll(",", "").trim() : value;
    const numeric =
      typeof normalized === "number"
        ? normalized
        : typeof normalized === "string" && normalized
          ? Number(normalized)
          : Number.NaN;
    if (!Number.isFinite(numeric) || numeric <= 0) {
      throw new Error(`The intake agent sent an invalid number for ${path}`);
    }
    return numeric;
  }

  if (path === "operations") {
    if (Array.isArray(value) && value.length > 0) return value;
    if (typeof value !== "string" || !value.trim()) {
      throw new Error("The intake agent sent invalid repair operations");
    }
    const trimmed = value.trim();
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error("The intake agent sent invalid repair operations");
      }
      return parsed;
    } catch (error) {
      if (error instanceof SyntaxError) return [trimmed];
      throw error;
    }
  }

  if (typeof value === "string" || typeof value === "number" || Array.isArray(value)) {
    return value;
  }
  throw new Error("The intake agent sent an invalid field update");
}

function IntakePage() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const specs = useWrenchStore((s) => s.specs);
  const session = useWrenchStore((s) => s.sessions[id]);
  const setSpec = useWrenchStore((s) => s.setSpec);
  const sync = useRequestSync(id);
  const spec = useMemo(() => Object.values(specs).find((s) => s.sessionId === id), [id, specs]);

  const [connected, setConnected] = useState(false);
  const [muted, setMuted] = useState(false);
  const [activeRole, setActiveRole] = useState<Turn["role"] | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [duration, setDuration] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string>();
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);
  const mountedRef = useRef(true);
  const startedAtRef = useRef<number>(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const agentSpeaking = activeRole === "agent";
  const audioPlaying = activeRole !== null;

  useEffect(() => {
    if (!connected) return;
    const t = setInterval(
      () => setDuration(Math.floor((Date.now() - startedAtRef.current) / 1000)),
      250,
    );
    return () => clearInterval(t);
  }, [connected]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns.length]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runIdRef.current += 1;
      abortRef.current?.abort();
      activeSourceRef.current?.stop();
      const context = audioContextRef.current;
      audioContextRef.current = null;
      gainNodeRef.current = null;
      if (context && context.state !== "closed") void context.close();
    };
  }, []);

  function ensureAudioContext() {
    let context = audioContextRef.current;
    if (!context || context.state === "closed") {
      context = new AudioContext();
      const gain = context.createGain();
      gain.gain.value = muted ? 0 : 1;
      gain.connect(context.destination);
      audioContextRef.current = context;
      gainNodeRef.current = gain;
    }
    return context;
  }

  function playTurn(
    context: AudioContext,
    audio: AudioBuffer,
    turn: DemoIntakeTurn,
    runId: number,
    specId: string,
  ) {
    return new Promise<void>((resolve, reject) => {
      if (runIdRef.current !== runId) {
        resolve();
        return;
      }
      const source = context.createBufferSource();
      source.buffer = audio;
      source.connect(gainNodeRef.current ?? context.destination);
      source.onended = () => {
        if (activeSourceRef.current === source) activeSourceRef.current = null;
        if (mountedRef.current && runIdRef.current === runId) setActiveRole(null);
        resolve();
      };
      activeSourceRef.current = source;
      try {
        source.start();
      } catch (reason) {
        reject(reason);
        return;
      }
      setActiveRole(turn.role);
      setTurns((previous) => [
        ...previous,
        { role: turn.role, text: turn.text, at: Date.now() - startedAtRef.current },
      ]);
      if (turn.fieldUpdate) {
        useWrenchStore
          .getState()
          .updateSpecField(specId, turn.fieldUpdate.path, turn.fieldUpdate.value, "voice");
      }
    });
  }

  async function connect() {
    if (!spec || connected) return;
    if (spec.status === "confirmed") {
      setSpec({
        ...spec,
        status: "draft",
        confirmedAt: undefined,
        specHash: undefined,
      });
    }
    const context = ensureAudioContext();
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    const controller = new AbortController();
    abortRef.current = controller;
    startedAtRef.current = Date.now();
    setDuration(0);
    setTurns([]);
    setCompleted(false);
    setError(undefined);
    setActiveRole(null);
    setConnected(true);

    try {
      await context.resume();
      let pendingAudio = fetchDemoIntakeAudio(0, controller.signal);
      for (let index = 0; index < DEMO_INTAKE_TURNS.length; index += 1) {
        const bytes = await pendingAudio;
        if (runIdRef.current !== runId) return;
        const decoded = await context.decodeAudioData(bytes.slice(0));
        const nextAudio =
          index + 1 < DEMO_INTAKE_TURNS.length
            ? fetchDemoIntakeAudio(index + 1, controller.signal)
            : undefined;
        if (nextAudio) void nextAudio.catch(() => undefined);
        await playTurn(context, decoded, DEMO_INTAKE_TURNS[index], runId, spec.id);
        if (runIdRef.current !== runId) return;
        if (nextAudio) pendingAudio = nextAudio;
      }
      if (runIdRef.current === runId) {
        setConnected(false);
        setCompleted(true);
      }
    } catch (reason) {
      if (controller.signal.aborted || runIdRef.current !== runId) return;
      setError(reason instanceof Error ? reason.message : "The intake voice failed");
      setConnected(false);
      setActiveRole(null);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function disconnect() {
    runIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    activeSourceRef.current?.stop();
    activeSourceRef.current = null;
    setConnected(false);
    setActiveRole(null);
  }

  function toggleMuted() {
    setMuted((current) => {
      const next = !current;
      const context = audioContextRef.current;
      const gain = gainNodeRef.current;
      if (context && gain) gain.gain.setValueAtTime(next ? 0 : 1, context.currentTime);
      return next;
    });
  }

  const checklist = useMemo(() => {
    if (!spec) return [];
    return [
      {
        key: "vehicle.mileage",
        label: "Current mileage confirmed",
        done: spec.fieldMeta["vehicle.mileage"]?.status === "verified",
      },
      {
        key: "operations",
        label: "Operations confirmed",
        done: spec.fieldMeta["operations"]?.status === "verified",
      },
      {
        key: "completionByDays",
        label: "Completion window set",
        done: spec.fieldMeta["completionByDays"]?.status === "verified",
      },
      {
        key: "location",
        label: "Location confirmed",
        done: spec.fieldMeta["location"]?.status === "verified",
      },
    ];
  }, [spec]);

  const allDone = checklist.every((c) => c.done);

  if (!spec) {
    return (
      <AppShell>
        <div className="mx-auto max-w-md py-16 text-center text-muted-foreground">
          {sync.loading ? "Loading the secure request…" : (sync.error ?? "Request not found.")}
        </div>
      </AppShell>
    );
  }

  if (session?.mode === "live") {
    return (
      <ConversationProvider>
        <LiveIntakePage spec={spec} />
      </ConversationProvider>
    );
  }

  return (
    <AppShell>
      <div className="mono mb-2 text-xs uppercase tracking-widest text-lime">
        Step 3 · Voice intake
      </div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Voice interview</h1>
          <p className="mt-1 text-muted-foreground">
            A short scripted conversation fills any missing spec fields before we call shops.
          </p>
        </div>
        <Button
          disabled={!allDone}
          onClick={() => nav({ to: "/requests/$id/spec", params: { id } })}
          className="bg-lime text-lime-foreground hover:brightness-95 disabled:opacity-40"
        >
          Continue to spec review <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="hairline rounded-xl bg-surface/60 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "relative h-10 w-10 rounded-full",
                  connected ? "bg-lime/20" : "bg-muted",
                )}
              >
                <div
                  className={cn(
                    "absolute inset-0 rounded-full",
                    agentSpeaking && "animate-ping bg-lime/40",
                  )}
                />
                <div className="absolute inset-2 rounded-full bg-lime/70" />
              </div>
              <div>
                <div className="font-medium">WrenchBid Intake Agent</div>
                <div className="mono text-xs text-muted-foreground">
                  {connected
                    ? activeRole === "agent"
                      ? "Agent speaking…"
                      : activeRole === "customer"
                        ? "Customer replying…"
                        : "Preparing ElevenLabs voice…"
                    : completed
                      ? "Interview complete"
                      : "Ready"}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Pill tone={connected ? "lime" : "muted"}>
                {connected
                  ? `● ${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, "0")}`
                  : completed
                    ? "Complete"
                    : "Not connected"}
              </Pill>
              {connected ? (
                <>
                  <Button size="sm" variant="secondary" onClick={toggleMuted}>
                    {muted ? <MicOff className="mr-2 h-4 w-4" /> : <Mic className="mr-2 h-4 w-4" />}
                    {muted ? "Unmute" : "Mute"}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={disconnect}>
                    <PhoneOff className="mr-2 h-4 w-4" /> Hang up
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  onClick={connect}
                  className="bg-lime text-lime-foreground hover:brightness-95"
                >
                  {completed ? "Replay interview" : "Connect"}
                </Button>
              )}
            </div>
          </div>

          {/* Waveform */}
          <div className="mt-5 flex h-16 items-center justify-center gap-1 rounded-md bg-background/50 p-3">
            {Array.from({ length: 48 }).map((_, i) => (
              <motion.div
                key={i}
                className="w-1 rounded-full bg-lime/70"
                animate={{
                  height: connected
                    ? [
                        4,
                        4 +
                          (audioPlaying
                            ? agentSpeaking
                              ? Math.random() * 40
                              : Math.random() * 24
                            : 0),
                        4,
                      ]
                    : 4,
                }}
                transition={{ duration: 0.6 + (i % 5) * 0.05, repeat: Infinity, ease: "easeInOut" }}
              />
            ))}
          </div>

          {/* Transcript */}
          <div className="mono mt-5 text-[10px] uppercase tracking-widest text-muted-foreground">
            Live transcript
          </div>
          <div className="mt-2 max-h-80 overflow-y-auto rounded-md bg-background/40 p-3">
            {turns.length === 0 && (
              <div className="text-sm text-muted-foreground">
                Transcript will stream here once connected.
              </div>
            )}
            <AnimatePresence initial={false}>
              {turns.map((t, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "mb-2 flex gap-3 text-sm",
                    t.role === "agent" ? "" : "flex-row-reverse",
                  )}
                >
                  <div
                    className={cn(
                      "mono text-[10px] uppercase tracking-widest",
                      t.role === "agent" ? "text-lime" : "text-[color:var(--cobalt)]",
                    )}
                  >
                    {t.role}
                  </div>
                  <div
                    className={cn(
                      "rounded-md px-3 py-1.5",
                      t.role === "agent" ? "bg-lime/10" : "bg-secondary",
                    )}
                  >
                    {t.text}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            <div ref={bottomRef} />
          </div>
          {error && (
            <div
              role="alert"
              aria-live="assertive"
              className="mt-3 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger"
            >
              {error}
            </div>
          )}
          <p className="mono mt-2 text-[10px] uppercase tracking-widest text-amber">
            Scripted ElevenLabs voices · no phone call
          </p>
        </div>

        <div className="hairline rounded-xl bg-surface/60 p-5">
          <div className="mono mb-3 text-[10px] uppercase tracking-widest text-lime">
            RepairSpec progress
          </div>
          <ul className="space-y-2">
            {checklist.map((c) => (
              <li
                key={c.key}
                className={cn(
                  "flex items-center gap-2 rounded-md p-2",
                  c.done ? "bg-verified/10" : "bg-background/40",
                )}
              >
                {c.done ? (
                  <CheckCircle2 className="h-4 w-4 text-verified" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground" />
                )}
                <span
                  className={cn("text-sm", c.done ? "text-foreground" : "text-muted-foreground")}
                >
                  {c.label}
                </span>
              </li>
            ))}
          </ul>
          <div className="mono mt-6 text-[10px] uppercase tracking-widest text-muted-foreground">
            Spec snapshot
          </div>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Vehicle</dt>
              <dd className="mono">
                {spec.vehicle.year} {spec.vehicle.make} {spec.vehicle.model} {spec.vehicle.trim}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Mileage</dt>
              <dd className="mono">{spec.vehicle.mileage.toLocaleString()}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Operations</dt>
              <dd className="mono">{spec.operations.length}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Deadline (days)</dt>
              <dd className="mono">{spec.completionByDays}</dd>
            </div>
          </dl>
        </div>
      </div>
    </AppShell>
  );
}

function LiveIntakePage({ spec }: { spec: RepairSpec }) {
  const nav = useNavigate();
  const setSpec = useWrenchStore((state) => state.setSpec);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState<string>();
  const [duration, setDuration] = useState(0);
  const startedAt = useRef(0);

  const conversation = useConversation({
    onConnect: ({ conversationId }) => {
      startedAt.current = Date.now();
      setError(undefined);
      void registerVoiceConversation(spec.sessionId, conversationId).catch(() => {
        conversation.endSession();
        setError(
          "The voice session could not be registered for privacy-safe deletion, so it was ended.",
        );
      });
    },
    onMessage: (event) => {
      const message = event as unknown as Record<string, unknown>;
      const text =
        typeof message.message === "string"
          ? message.message
          : typeof message.text === "string"
            ? message.text
            : "";
      if (!text) return;
      const source = String(message.source ?? message.role ?? "agent");
      setTurns((current) => [
        ...current,
        {
          role: source === "user" || source === "customer" ? "customer" : "agent",
          text,
          at: Date.now() - startedAt.current,
        },
      ]);
    },
    onError: (message) =>
      setError(typeof message === "string" ? message : "The voice session failed"),
    clientTools: {
      update_repair_spec: async (parameters: Record<string, unknown>) => {
        const path = typeof parameters.path === "string" ? parameters.path : "";
        if (!path) throw new Error("The intake agent sent an invalid field update");
        const value = coerceRepairSpecToolValue(path, parameters.value);
        const updated = await updateRepairSpec(spec.sessionId, path, value, "voice");
        setSpec(updated);
        return "RepairSpec field saved";
      },
    },
  });

  useEffect(() => {
    if (conversation.status !== "connected") return;
    const timer = setInterval(
      () => setDuration(Math.floor((Date.now() - startedAt.current) / 1000)),
      500,
    );
    return () => clearInterval(timer);
  }, [conversation.status]);

  const checklist = [
    {
      label: "Current mileage confirmed",
      done: spec.fieldMeta["vehicle.mileage"]?.status === "verified",
    },
    { label: "Operations confirmed", done: spec.fieldMeta.operations?.status === "verified" },
    {
      label: "Completion window set",
      done: spec.fieldMeta.completionByDays?.status === "verified",
    },
    { label: "Location confirmed", done: spec.fieldMeta.location?.status === "verified" },
  ];
  const allDone = checklist.every((item) => item.done);

  async function connect() {
    setError(undefined);
    try {
      const permission = await navigator.mediaDevices.getUserMedia({ audio: true });
      permission.getTracks().forEach((track) => track.stop());
      const { token } = await getVoiceToken(spec.sessionId);
      conversation.startSession({
        conversationToken: token,
        connectionType: "webrtc",
        dynamicVariables: {
          wrenchbid_request_id: spec.sessionId,
          repair_spec_json: JSON.stringify(spec),
          missing_fields: Object.entries(spec.fieldMeta)
            .filter(([, meta]) => meta.status !== "verified")
            .map(([field]) => field)
            .join(", "),
        },
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Microphone or voice connection failed");
    }
  }

  async function disconnect() {
    setError(undefined);
    try {
      await conversation.endSession();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "The voice session could not end cleanly",
      );
    }
  }

  return (
    <AppShell>
      <div className="mono mb-2 text-xs uppercase tracking-widest text-lime">
        Step 3 · Voice intake
      </div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Private voice interview</h1>
          <p className="mt-1 text-muted-foreground">
            A server-issued, single-session token connects your browser to the configured ElevenLabs
            intake agent. The API key never reaches this page.
          </p>
        </div>
        <Button
          disabled={!allDone}
          onClick={() => nav({ to: "/requests/$id/spec", params: { id: spec.sessionId } })}
          className="bg-lime text-lime-foreground hover:brightness-95 disabled:opacity-40"
        >
          Continue to spec review <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="hairline rounded-xl bg-surface/60 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-medium">WrenchBid Intake Agent</div>
              <div className="mono text-xs text-muted-foreground">
                {conversation.status} ·{" "}
                {conversation.isSpeaking
                  ? "speaking"
                  : conversation.isListening
                    ? "listening"
                    : "idle"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Pill tone={conversation.status === "connected" ? "lime" : "muted"}>
                {Math.floor(duration / 60)}:{(duration % 60).toString().padStart(2, "0")}
              </Pill>
              {conversation.status === "connected" ? (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => conversation.setMuted(!conversation.isMuted)}
                  >
                    {conversation.isMuted ? (
                      <MicOff className="mr-2 h-4 w-4" />
                    ) : (
                      <Mic className="mr-2 h-4 w-4" />
                    )}
                    {conversation.isMuted ? "Unmute" : "Mute"}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => void disconnect()}>
                    <PhoneOff className="mr-2 h-4 w-4" /> End
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  onClick={() => void connect()}
                  disabled={conversation.status === "connecting"}
                  className="bg-lime text-lime-foreground"
                >
                  {conversation.status === "connecting" ? "Connecting…" : "Start interview"}
                </Button>
              )}
            </div>
          </div>

          <div
            className="mt-5 max-h-80 min-h-48 overflow-y-auto rounded-md bg-background/40 p-3"
            aria-live="polite"
          >
            {turns.length === 0 && (
              <p className="text-sm text-muted-foreground">
                The live transcript appears here after you start. The configured agent must expose
                the <span className="mono">update_repair_spec</span> client tool.
              </p>
            )}
            {turns.map((turn, index) => (
              <div
                key={`${turn.at}-${index}`}
                className={cn(
                  "mb-2 flex gap-3 text-sm",
                  turn.role === "customer" && "flex-row-reverse",
                )}
              >
                <span className="mono text-[10px] uppercase tracking-widest text-lime">
                  {turn.role}
                </span>
                <span className="rounded-md bg-secondary px-3 py-1.5">{turn.text}</span>
              </div>
            ))}
          </div>
          {error && (
            <div
              role="alert"
              aria-live="assertive"
              className="mt-3 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger"
            >
              {error}
            </div>
          )}
          <p className="mono mt-3 text-[10px] uppercase tracking-widest text-verified">
            Live adapter · WebRTC · server-issued token
          </p>
        </div>

        <div className="hairline rounded-xl bg-surface/60 p-5">
          <div className="mono mb-3 text-[10px] uppercase tracking-widest text-lime">
            RepairSpec progress
          </div>
          <ul className="space-y-2">
            {checklist.map((item) => (
              <li
                key={item.label}
                className={cn(
                  "flex items-center gap-2 rounded-md p-2",
                  item.done ? "bg-verified/10" : "bg-background/40",
                )}
              >
                {item.done ? (
                  <CheckCircle2 className="h-4 w-4 text-verified" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="text-sm">{item.label}</span>
              </li>
            ))}
          </ul>
          {!allDone && (
            <Button
              variant="secondary"
              className="mt-5 w-full"
              onClick={() =>
                nav({ to: "/requests/$id/extraction", params: { id: spec.sessionId } })
              }
            >
              Use manual confirmation fallback
            </Button>
          )}
        </div>
      </div>
    </AppShell>
  );
}
