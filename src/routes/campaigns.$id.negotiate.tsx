import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/wrenchbid/AppShell";
import { useWrenchStore } from "@/lib/wrenchbid/store";
import { useEffect, useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pill } from "@/components/wrenchbid/StatusPill";
import { money } from "@/lib/wrenchbid/format";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Sparkles, ShieldCheck } from "lucide-react";
import type { Quote, NegotiationAsk } from "@/lib/wrenchbid/types";
import { useCampaignSync } from "@/hooks/use-live-sync";
import { startRemoteNegotiation } from "@/lib/wrenchbid/api";

const ASKS: Array<{ value: NegotiationAsk; label: string }> = [
  { value: "beat_or_match", label: "Ask to beat or match price" },
  { value: "waive_diagnostic", label: "Ask to waive diagnostic fee" },
  { value: "waive_shop_supply", label: "Ask to waive shop-supply fee" },
  { value: "better_warranty", label: "Ask for better warranty" },
  { value: "earlier_appointment", label: "Ask for earlier appointment" },
];

export const Route = createFileRoute("/campaigns/$id/negotiate")({
  head: () => ({
    meta: [{ title: "Negotiate — WrenchBid" }, { name: "robots", content: "noindex" }],
  }),
  component: NegotiatePage,
});

function NegotiatePage() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const calls = useWrenchStore((s) => s.calls);
  const quotes = useWrenchStore((s) => s.quotes);
  const shops = useWrenchStore((s) => s.shops);
  const negotiations = useWrenchStore((s) => s.negotiations);
  const campaign = useWrenchStore((s) => s.campaigns[id]);
  const applyNegotiation = useWrenchStore((s) => s.applyNegotiation);
  const sync = useCampaignSync(id);

  const campaignQuotes = useMemo(() => {
    const ids = Object.values(calls)
      .filter((c) => c.campaignId === id && c.kind === "quote")
      .map((c) => c.id);
    return Object.values(quotes).filter(
      (q) =>
        ids.includes(q.callId) &&
        q.status === "complete" &&
        q.completeness >= 0.9 &&
        q.confirmedInCall &&
        !q.warnings.includes("revised_after_negotiation"),
    );
  }, [calls, quotes, id]);

  // Recommend: lowest complete total that isn't range_only, use as target; leverage = lowest total from another shop
  const sortedByTotal = [...campaignQuotes].sort((a, b) => (a.total ?? 1e9) - (b.total ?? 1e9));
  const [targetId, setTargetId] = useState<string>("");
  const target = campaignQuotes.find((q) => q.id === targetId);
  const leverageChoices = campaignQuotes.filter((q) => q.id !== targetId);
  const [leverageId, setLeverageId] = useState<string>("");
  const leverage = campaignQuotes.find((q) => q.id === leverageId);

  const [asks, setAsks] = useState<Set<NegotiationAsk>>(
    new Set(["beat_or_match", "waive_shop_supply"]),
  );
  const [running, setRunning] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string>();

  const campaignNegotiations = Object.values(negotiations).filter(
    (negotiation) => negotiation.campaignId === id,
  );
  const activeNegotiation = campaignNegotiations.at(-1);
  const revised = activeNegotiation?.revisedQuoteId
    ? quotes[activeNegotiation.revisedQuoteId]
    : undefined;
  const approvedTarget = activeNegotiation ? quotes[activeNegotiation.originalQuoteId] : target;
  const approvedLeverage = activeNegotiation ? quotes[activeNegotiation.leverageQuoteId] : leverage;
  const approvedAsks = activeNegotiation?.asks ?? Array.from(asks);
  const done = ["revised", "rejected", "failed"].includes(activeNegotiation?.outcome ?? "");
  const pending = activeNegotiation?.outcome === "pending";

  useEffect(() => {
    if (!targetId || !campaignQuotes.some((quote) => quote.id === targetId)) {
      setTargetId(
        sortedByTotal.find((quote) => quote.warnings.length === 0)?.id ??
          sortedByTotal[0]?.id ??
          "",
      );
    }
  }, [campaignQuotes, sortedByTotal, targetId]);

  useEffect(() => {
    if (
      !leverageId ||
      leverageId === targetId ||
      !campaignQuotes.some((quote) => quote.id === leverageId)
    ) {
      setLeverageId(campaignQuotes.find((quote) => quote.id !== targetId)?.id ?? "");
    }
  }, [campaignQuotes, leverageId, targetId]);

  function toggle(a: NegotiationAsk) {
    setAsks((prev) => {
      const n = new Set(prev);
      if (n.has(a)) n.delete(a);
      else n.add(a);
      return n;
    });
  }

  async function startNegotiation() {
    if (!target || !leverage) return;
    setRunning(true);
    setError(undefined);
    try {
      if (campaign?.mode === "live") {
        await startRemoteNegotiation({
          campaignId: id,
          originalQuoteId: target.id,
          leverageQuoteId: leverage.id,
          asks: Array.from(asks),
        });
        setSubmitted(true);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        applyNegotiation(Array.from(asks));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The negotiation call could not start");
    } finally {
      setRunning(false);
    }
  }

  if (!approvedTarget)
    return (
      <AppShell>
        <div className="mx-auto max-w-md py-16 text-center text-muted-foreground">
          {sync.loading
            ? "Loading verified quotes…"
            : (sync.error ?? "At least two complete quotes are required before negotiation.")}
        </div>
      </AppShell>
    );

  return (
    <AppShell>
      <div className="mono mb-2 text-xs uppercase tracking-widest text-lime">
        Step 8 · Negotiate
      </div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Approve a negotiation</h1>
          <p className="mt-1 text-muted-foreground">
            WrenchBid will not fabricate a competing quote. The leverage must come from a stored,
            completed quote.
          </p>
        </div>
        <Button
          disabled={!done}
          onClick={() => nav({ to: "/campaigns/$id/report", params: { id } })}
          className="bg-lime text-lime-foreground hover:brightness-95 disabled:opacity-40"
        >
          Continue to report <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-4">
          <div className="hairline rounded-xl bg-surface/60 p-5">
            <div className="mono mb-3 text-[10px] uppercase tracking-widest text-lime">
              Selected shop (target)
            </div>
            <Select
              value={activeNegotiation?.originalQuoteId ?? targetId}
              onValueChange={setTargetId}
              disabled={Boolean(activeNegotiation)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {campaignQuotes.map((q) => (
                  <SelectItem key={q.id} value={q.id}>
                    {shops[q.shopId]?.name} · {money(q.total)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="mt-3 grid gap-2 text-sm">
              <Row
                k="Original total"
                v={<span className="mono text-lg">{money(approvedTarget.total)}</span>}
              />
              <Row k="Warranty" v={approvedTarget.warrantyText ?? "—"} />
              <Row k="Appointment" v={approvedTarget.earliestDate ?? "—"} />
            </div>
          </div>

          <div className="hairline rounded-xl bg-surface/60 p-5">
            <div className="mono mb-3 text-[10px] uppercase tracking-widest text-lime">
              Verified competing quote (leverage)
            </div>
            <Select
              value={activeNegotiation?.leverageQuoteId ?? leverageId}
              onValueChange={setLeverageId}
              disabled={Boolean(activeNegotiation)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {leverageChoices.map((q) => (
                  <SelectItem key={q.id} value={q.id}>
                    {shops[q.shopId]?.name} · {money(q.total)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {approvedLeverage && (
              <div className="mt-3 grid gap-2 text-sm">
                <Row
                  k="Competing total"
                  v={<span className="mono">{money(approvedLeverage.total)}</span>}
                />
                <Row k="Warranty" v={approvedLeverage.warrantyText ?? "—"} />
                <Row k="Warnings" v={approvedLeverage.warnings.join(", ") || "None"} />
              </div>
            )}
            <p className="mono mt-3 text-[10px] uppercase tracking-widest text-verified">
              <ShieldCheck className="mr-1 inline h-3 w-3" /> Leverage selection is restricted to
              completed captured quotes.
            </p>
          </div>

          <div className="hairline rounded-xl bg-surface/60 p-5">
            <div className="mono mb-3 text-[10px] uppercase tracking-widest text-lime">
              Negotiation asks
            </div>
            <div className="grid gap-2">
              {ASKS.map((a) => (
                <label
                  key={a.value}
                  className="flex items-center gap-2 rounded-md bg-background/40 p-2 text-sm"
                >
                  <Checkbox checked={asks.has(a.value)} onCheckedChange={() => toggle(a.value)} />
                  <span>{a.label}</span>
                </label>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                User approval required. No calls will be placed until you confirm.
              </p>
              <Button
                disabled={running || submitted || pending || done || asks.size === 0 || !leverage}
                onClick={startNegotiation}
                className="bg-lime text-lime-foreground hover:brightness-95 disabled:opacity-40"
              >
                {running
                  ? "Starting…"
                  : (submitted || pending) && !done
                    ? "Waiting for call result…"
                    : done
                      ? "Resolved"
                      : "Approve & start"}
              </Button>
            </div>
          </div>
        </div>

        <div>
          <div className="hairline rounded-xl bg-surface/60 p-5">
            <div className="mono mb-3 text-[10px] uppercase tracking-widest text-lime">Result</div>
            <AnimatePresence mode="wait">
              {!done ? (
                <motion.div
                  key="pending"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="rounded-md bg-background/40 p-6 text-center"
                >
                  <Sparkles className="mx-auto mb-2 h-6 w-6 text-lime" />
                  <div className="text-sm text-muted-foreground">
                    {running
                      ? "Placing negotiation call…"
                      : submitted || pending
                        ? "The real call is in progress. A verified webhook will update this result."
                        : "Approve to place the negotiation call."}
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="done"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  {activeNegotiation?.outcome === "revised" && revised ? (
                    <BeforeAfter
                      before={approvedTarget.total}
                      after={revised.total}
                      confirmed={revised.confirmedInCall}
                    />
                  ) : activeNegotiation?.outcome === "failed" ? (
                    <div className="rounded-md border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
                      The negotiation call failed technically. The original quote remains unchanged.
                    </div>
                  ) : activeNegotiation?.outcome === "revised" ? (
                    <div className="rounded-md border border-amber/30 bg-amber/5 p-4 text-sm text-amber">
                      The shop reported revised terms, but the revised quote is not available.
                    </div>
                  ) : (
                    <div className="rounded-md border border-amber/30 bg-amber/5 p-4 text-sm text-amber">
                      The shop declined to revise its terms. The original quote remains unchanged.
                    </div>
                  )}
                  <div className="grid gap-2 text-sm">
                    <Row
                      k="Warranty"
                      v={revised?.warrantyText ?? approvedTarget.warrantyText ?? "—"}
                    />
                    <Row
                      k="Appointment"
                      v={revised?.earliestDate ?? approvedTarget.earliestDate ?? "—"}
                    />
                    <Row
                      k="Applied asks"
                      v={approvedAsks.map((a) => a.replace(/_/g, " ")).join(", ")}
                    />
                    <div className="flex flex-wrap gap-1.5 pt-2">
                      {activeNegotiation?.outcome === "revised" && revised ? (
                        <Pill
                          tone={revised.confirmedInCall ? "verified" : "amber"}
                          icon={
                            revised.confirmedInCall ? (
                              <ShieldCheck className="h-3 w-3" />
                            ) : undefined
                          }
                        >
                          {revised.confirmedInCall
                            ? "Transcript-confirmed revision"
                            : "Revision captured · total unverified"}
                        </Pill>
                      ) : activeNegotiation?.outcome === "failed" ? (
                        <Pill tone="danger">Technical failure</Pill>
                      ) : activeNegotiation?.outcome === "rejected" ? (
                        <Pill tone="amber">No revision</Pill>
                      ) : (
                        <Pill tone="amber">Revision unavailable</Pill>
                      )}
                      {approvedLeverage && (
                        <Pill tone="lime">Leverage: {shops[approvedLeverage.shopId]?.name}</Pill>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
      {error && (
        <div className="mt-4 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      )}
    </AppShell>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between text-sm">
      <dt className="text-muted-foreground">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

function BeforeAfter({
  before,
  after,
  confirmed,
}: {
  before: number | null | undefined;
  after: number | null | undefined;
  confirmed: boolean;
}) {
  const difference = before != null && after != null ? before - after : null;
  const isLower = difference != null && difference > 0;
  const isHigher = difference != null && difference < 0;
  const isConfirmedLower = confirmed && isLower;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="rounded-md border border-border bg-background/40 p-4">
        <div className="mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Original offer
        </div>
        <div className="mono mt-1 text-3xl font-semibold text-muted-foreground line-through">
          {money(before)}
        </div>
      </div>
      <motion.div
        initial={{ scale: 0.96, opacity: 0.6 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", damping: 18 }}
        className={
          isConfirmedLower
            ? "rounded-md border border-lime/60 bg-lime/10 p-4"
            : isHigher || !confirmed
              ? "rounded-md border border-amber/60 bg-amber/10 p-4"
              : "rounded-md border border-border bg-background/40 p-4"
        }
      >
        <div
          className={`mono text-[10px] uppercase tracking-widest ${
            isConfirmedLower
              ? "text-lime"
              : isHigher || !confirmed
                ? "text-amber"
                : "text-muted-foreground"
          }`}
        >
          Revised offer
        </div>
        <div
          className={`mono mt-1 text-3xl font-semibold ${
            isConfirmedLower
              ? "text-lime"
              : isHigher || !confirmed
                ? "text-amber"
                : "text-foreground"
          }`}
        >
          {money(after)}
        </div>
        <div
          className={`mono mt-1 text-xs ${
            isConfirmedLower
              ? "text-verified"
              : isHigher || !confirmed
                ? "text-amber"
                : "text-muted-foreground"
          }`}
        >
          {difference == null
            ? "Price change unavailable"
            : !confirmed
              ? isLower
                ? `Reported ${money(difference)} lower · total unverified`
                : isHigher
                  ? `Reported ${money(Math.abs(difference))} above original · total unverified`
                  : "Reported no price change · total unverified"
              : isLower
                ? `− ${money(difference)} saved`
                : isHigher
                  ? `+ ${money(Math.abs(difference))} above original`
                  : "No price change"}
        </div>
      </motion.div>
    </div>
  );
}
