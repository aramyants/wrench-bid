import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/wrenchbid/AppShell";
import { useWrenchStore, useHydrated } from "@/lib/wrenchbid/store";
import { useMemo } from "react";
import { CallStatusPill, Pill } from "@/components/wrenchbid/StatusPill";
import { money, timestamp } from "@/lib/wrenchbid/format";
import { Button } from "@/components/ui/button";
import { PhoneCall, ArrowRight, FileAudio2, MessageSquareText, Sparkles } from "lucide-react";
import type { Call, CallStatus } from "@/lib/wrenchbid/types";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useCampaignSync } from "@/hooks/use-live-sync";

export const Route = createFileRoute("/campaigns/$id/")({
  head: () => ({
    meta: [{ title: "Call campaign — WrenchBid" }, { name: "robots", content: "noindex" }],
  }),
  component: CampaignPage,
});

const ORDER: CallStatus[] = ["queued", "ringing", "connected", "collecting_quote", "completed"];

function CampaignPage() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const campaign = useWrenchStore((s) => s.campaigns[id]);
  const calls = useWrenchStore((s) => s.calls);
  const shops = useWrenchStore((s) => s.shops);
  const quotes = useWrenchStore((s) => s.quotes);
  const campaignCalls = useMemo(
    () => Object.values(calls).filter((c) => c.campaignId === id && c.kind === "quote"),
    [calls, id],
  );
  const sync = useCampaignSync(id);

  const hydrated = useHydrated();
  if (!hydrated) {
    return (
      <AppShell>
        <div className="mx-auto max-w-md py-16 text-center text-muted-foreground mono text-xs uppercase tracking-widest">
          Loading…
        </div>
      </AppShell>
    );
  }
  if (!campaign) {
    return (
      <AppShell>
        <div className="mx-auto max-w-md text-center">
          <h1 className="text-2xl font-semibold">Campaign not found</h1>
          <p className="mt-2 text-muted-foreground">
            {sync.loading
              ? "Loading the server-backed campaign…"
              : (sync.error ?? "This campaign may have been deleted.")}
          </p>
          <Link to="/" className="mt-4 inline-block text-lime underline">
            Home
          </Link>
        </div>
      </AppShell>
    );
  }

  const isReplay = campaign.mode === "replay";
  const terminal = new Set<CallStatus>([
    "completed",
    "declined",
    "no_answer",
    "failed",
    "waiting_callback",
  ]);
  const resolved = campaignCalls.filter((c) => terminal.has(c.status)).length;
  const allDone = campaignCalls.length > 0 && resolved === campaignCalls.length;

  return (
    <AppShell replayLabel={isReplay ? "Recorded demo session — not a live call" : undefined}>
      <div className="mono mb-2 text-xs uppercase tracking-widest text-lime">
        Step 6 · {isReplay ? "Recorded campaign" : "Live campaign"}
      </div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Call campaign</h1>
          <p className="mt-1 text-muted-foreground">
            All calls use the identical confirmed RepairSpec. Status updates stream in as each call
            progresses.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Pill tone={allDone ? "verified" : "cobalt"} icon={<PhoneCall className="h-3 w-3" />}>
            {resolved}/{campaignCalls.length} resolved
          </Pill>
          <Button
            disabled={!allDone}
            className="bg-lime text-lime-foreground hover:brightness-95 disabled:opacity-40"
            onClick={() => nav({ to: "/campaigns/$id/compare", params: { id } })}
          >
            Compare quotes <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Timeline */}
      <div className="hairline mb-6 rounded-xl bg-surface/60 p-4">
        <div className="mono mb-3 text-[10px] uppercase tracking-widest text-muted-foreground">
          Timeline
        </div>
        <ol className="flex flex-wrap items-center gap-3 text-sm">
          {[
            "Campaign started",
            "Sessions connected",
            "Quotes received",
            "Normalization complete",
          ].map((label, i) => {
            const reached =
              i === 0
                ? true
                : i === 1
                  ? campaignCalls.some((c) => ORDER.indexOf(c.status) >= 2)
                  : i === 2
                    ? campaignCalls.every((c) => terminal.has(c.status))
                    : allDone;
            return (
              <li key={label} className="flex items-center gap-2">
                <span
                  className={cn(
                    "mono flex h-6 w-6 items-center justify-center rounded-full border text-[10px]",
                    reached
                      ? "border-lime bg-lime/20 text-lime"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {i + 1}
                </span>
                <span className={reached ? "text-foreground" : "text-muted-foreground"}>
                  {label}
                </span>
                {i < 3 && <span className="mx-1 h-px w-6 bg-border" />}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {campaignCalls.map((c) => (
          <CallCard
            key={c.id}
            call={c}
            shopName={shops[c.shopId]?.name ?? "Unknown shop"}
            quote={Object.values(quotes).find((q) => q.callId === c.id)}
          />
        ))}
      </div>
    </AppShell>
  );
}

function CallCard({
  call,
  shopName,
  quote,
}: {
  call: Call;
  shopName: string;
  quote?: import("@/lib/wrenchbid/types").Quote;
}) {
  const objective =
    call.status === "queued"
      ? "Queued to connect"
      : call.status === "ringing"
        ? "Connecting to shop"
        : call.status === "connected"
          ? "Introducing repair spec"
          : call.status === "collecting_quote"
            ? "Collecting itemized quote"
            : call.status === "completed"
              ? "Quote captured"
              : (call.currentObjective ?? "");

  const completeness = quote?.completeness ?? (call.status === "completed" ? 0.9 : 0);
  const lastTurn = call.transcript[call.transcript.length - 1];

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="hairline rounded-xl bg-surface/60 p-4"
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="font-semibold">{shopName}</div>
          <div className="mono mt-1 text-[10px] uppercase tracking-widest text-muted-foreground">
            {timestamp(call.durationSeconds)} · {call.transcript.length} turns
          </div>
        </div>
        <CallStatusPill status={call.status} />
      </div>

      <div className="mono mt-3 text-[10px] uppercase tracking-widest text-lime">
        Current objective
      </div>
      <div className="text-sm">{objective}</div>

      <div className="mt-3">
        <div className="mono mb-1 flex items-center justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
          <span>Quote completeness</span>
          <span
            className={completeness >= 0.9 ? "text-verified" : completeness > 0 ? "text-amber" : ""}
          >
            {Math.round(completeness * 100)}%
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <motion.div className="h-full bg-lime" animate={{ width: `${completeness * 100}%` }} />
        </div>
      </div>

      {lastTurn && (
        <div className="mt-3 rounded-md bg-background/40 p-2 text-xs">
          <div className="mono mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">
            <MessageSquareText className="mr-1 inline h-3 w-3" /> Transcript preview
          </div>
          <span className="mono text-[10px] uppercase tracking-widest text-lime">
            {lastTurn.speaker}
          </span>{" "}
          <span className="text-muted-foreground">"{lastTurn.text}"</span>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {call.audioAvailable && call.providerConversationId ? (
            <a
              href={`/api/calls/${encodeURIComponent(call.id)}/audio`}
              target="_blank"
              rel="noreferrer"
            >
              <Pill tone="verified" icon={<FileAudio2 className="h-3 w-3" />}>
                Audio
              </Pill>
            </a>
          ) : (
            <Pill tone="muted">No audio yet</Pill>
          )}
          {quote?.warnings.includes("hidden_fee_disclosed_late") && (
            <Pill tone="amber" icon={<Sparkles className="h-3 w-3" />}>
              Hidden fee
            </Pill>
          )}
        </div>
        {quote?.total != null && (
          <div className="mono text-sm text-foreground">{money(quote.total)}</div>
        )}
      </div>

      {call.failureReason && (
        <div className="mt-3 rounded-md border border-amber/40 bg-amber/10 p-2 text-xs text-amber">
          {call.failureReason}
        </div>
      )}
    </motion.div>
  );
}
