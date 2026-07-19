import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/wrenchbid/AppShell";
import { useWrenchStore } from "@/lib/wrenchbid/store";
import { useMemo, useState } from "react";
import { Pill } from "@/components/wrenchbid/StatusPill";
import { money, shortDate } from "@/lib/wrenchbid/format";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ArrowRight, Play, AlertTriangle, ShieldCheck, ArrowUpDown } from "lucide-react";
import type { Quote } from "@/lib/wrenchbid/types";
import { cn } from "@/lib/utils";
import { rankQuotes } from "@/lib/wrenchbid/ranking";
import { useCampaignSync } from "@/hooks/use-live-sync";

type SortKey = "total" | "appointment" | "warranty";

export const Route = createFileRoute("/campaigns/$id/compare")({
  head: () => ({
    meta: [{ title: "Compare quotes — WrenchBid" }, { name: "robots", content: "noindex" }],
  }),
  component: ComparePage,
});

function ComparePage() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const calls = useWrenchStore((s) => s.calls);
  const quotes = useWrenchStore((s) => s.quotes);
  const shops = useWrenchStore((s) => s.shops);
  const evidenceAll = useWrenchStore((s) => s.evidence);
  const sync = useCampaignSync(id, false);

  const campaignCalls = useMemo(
    () => Object.values(calls).filter((c) => c.campaignId === id && c.kind === "quote"),
    [calls, id],
  );
  const campaignQuotes = useMemo(
    () =>
      campaignCalls
        .map((c) => Object.values(quotes).find((q) => q.callId === c.id))
        .filter(Boolean) as Quote[],
    [campaignCalls, quotes],
  );

  const [sortKey, setSortKey] = useState<SortKey>("total");
  const [filterIncomplete, setFilterIncomplete] = useState(false);
  const [drawer, setDrawer] = useState<{ quote: Quote; field: string } | null>(null);

  const filtered = useMemo(() => {
    let list = [...campaignQuotes];
    if (filterIncomplete)
      list = list.filter((q) => q.status === "complete" && q.completeness >= 0.9);
    list.sort((a, b) => {
      if (sortKey === "total") return (a.total ?? 1e9) - (b.total ?? 1e9);
      if (sortKey === "appointment")
        return (a.earliestDate ?? "z").localeCompare(b.earliestDate ?? "z");
      return (b.warrantyDays ?? 0) - (a.warrantyDays ?? 0);
    });
    return list;
  }, [campaignQuotes, sortKey, filterIncomplete]);

  const ranked = useMemo(() => rankQuotes(campaignQuotes), [campaignQuotes]);
  const rankingByQuote = useMemo(
    () => new Map(ranked.map((entry) => [entry.quote.id, entry])),
    [ranked],
  );

  const rows: Array<{
    key: string;
    label: string;
    render: (q: Quote) => React.ReactNode;
    evidenceField?: string;
  }> = [
    { key: "parts", label: "Parts", render: (q) => item(q, "parts") },
    { key: "labor", label: "Labor", render: (q) => item(q, "labor") },
    {
      key: "diag",
      label: "Diagnostic fee",
      render: (q) => item(q, "diagnostic"),
      evidenceField: "diagnostic_fee",
    },
    {
      key: "supply",
      label: "Shop/disposal fee",
      render: (q) => item(q, "shop_supply", true) ?? item(q, "disposal", true) ?? "—",
      evidenceField: "shop_supply_fee",
    },
    { key: "tax", label: "Tax", render: (q) => money(q.tax) },
    {
      key: "total",
      label: "All-in total",
      render: (q) => <span className="mono text-lg text-foreground">{money(q.total)}</span>,
    },
    {
      key: "war",
      label: "Warranty",
      render: (q) => q.warrantyText ?? "—",
      evidenceField: "warranty",
    },
    { key: "app", label: "Earliest appointment", render: (q) => shortDate(q.earliestDate) },
    { key: "valid", label: "Quote expiration", render: (q) => shortDate(q.validUntil) },
    {
      key: "cond",
      label: "Conditions",
      render: (q) => (q.conditions.length ? q.conditions.join("; ") : "None"),
      evidenceField: "conditions",
    },
    {
      key: "comp",
      label: "Completeness",
      render: (q) => (
        <span className={cn("mono", q.completeness >= 0.95 ? "text-verified" : "text-amber")}>
          {Math.round(q.completeness * 100)}%
        </span>
      ),
    },
  ];

  return (
    <AppShell>
      <div className="mono mb-2 text-xs uppercase tracking-widest text-lime">Step 7 · Compare</div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Normalized quote comparison</h1>
          <p className="mt-1 text-muted-foreground">
            Captured evidence links each supported value to a transcript turn and audio timestamp;
            missing evidence is shown explicitly.
          </p>
        </div>
        <Button
          className="bg-lime text-lime-foreground hover:brightness-95"
          onClick={() =>
            nav({
              to: campaignQuotes.length >= 2 ? "/campaigns/$id/negotiate" : "/campaigns/$id/report",
              params: { id },
            })
          }
        >
          {campaignQuotes.length >= 2 ? "Negotiate" : "Review outcomes"}{" "}
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SortToggle sortKey={sortKey} setSortKey={setSortKey} k="total" label="Total" />
        <SortToggle sortKey={sortKey} setSortKey={setSortKey} k="appointment" label="Appointment" />
        <SortToggle sortKey={sortKey} setSortKey={setSortKey} k="warranty" label="Warranty" />
        <button
          onClick={() => setFilterIncomplete((v) => !v)}
          className={cn(
            "mono rounded-md border px-3 py-1.5 text-xs uppercase tracking-widest",
            filterIncomplete
              ? "border-lime bg-lime/10 text-lime"
              : "border-border text-muted-foreground hover:bg-secondary",
          )}
        >
          Hide incomplete
        </button>
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-xl border border-border bg-surface/40 md:block">
        <table className="w-full text-sm">
          <thead className="bg-surface/70">
            <tr className="text-left">
              <th className="mono px-4 py-3 text-[10px] uppercase tracking-widest text-muted-foreground">
                Field
              </th>
              {filtered.map((q) => (
                <th key={q.id} className="px-4 py-3">
                  <div className="font-semibold">{shops[q.shopId]?.name}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(rankingByQuote.get(q.id)?.warnings ?? q.warnings).map((w) => (
                      <Pill
                        key={w}
                        tone={w.startsWith("hidden") ? "amber" : "muted"}
                        icon={<AlertTriangle className="h-3 w-3" />}
                      >
                        {w.replace(/_/g, " ")}
                      </Pill>
                    ))}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-border/60">
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase tracking-wider">
                  {r.label}
                </th>
                {filtered.map((q) => (
                  <td key={q.id + r.key} className="px-4 py-3 align-top">
                    <div className="mono">{r.render(q)}</div>
                    {r.evidenceField && (
                      <button
                        onClick={() => setDrawer({ quote: q, field: r.evidenceField! })}
                        className="mono mt-1 text-[10px] uppercase tracking-widest text-lime hover:underline"
                      >
                        Evidence →
                      </button>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {campaignQuotes.length === 0 && (
        <div className="hairline rounded-xl bg-surface/50 p-6 text-sm text-muted-foreground">
          {sync.loading
            ? "Refreshing normalized quotes…"
            : (sync.error ??
              "No structured quotes are available yet. Callback, decline, and failed outcomes remain in the campaign record but are not fabricated into prices.")}
        </div>
      )}

      {/* Mobile cards */}
      <div className="grid gap-3 md:hidden">
        {filtered.map((q) => (
          <div key={q.id} className="hairline rounded-xl bg-surface/60 p-4">
            <div className="flex items-center justify-between">
              <div className="font-semibold">{shops[q.shopId]?.name}</div>
              <div className="mono text-lg">{money(q.total)}</div>
            </div>
            <dl className="mt-3 space-y-1 text-sm">
              {rows.slice(0, 6).map((r) => (
                <div key={r.key} className="flex justify-between">
                  <dt className="text-muted-foreground">{r.label}</dt>
                  <dd className="mono">{r.render(q)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>

      {/* Recommendation logic transparency */}
      <div className="mt-6 hairline rounded-xl bg-surface/50 p-5">
        <div className="mono mb-3 text-[10px] uppercase tracking-widest text-lime">How we rank</div>
        <ol className="grid gap-2 text-sm text-muted-foreground md:grid-cols-5">
          {[
            "1. Comparable scope",
            "2. Complete all-in total",
            "3. Outlier check",
            "4. User priority",
            "5. Transparent tie-break",
          ].map((s) => (
            <li key={s} className="hairline rounded-md bg-background/40 p-2">
              {s}
            </li>
          ))}
        </ol>
        <p className="mono mt-3 text-[10px] uppercase tracking-widest text-verified">
          <ShieldCheck className="mr-1 inline h-3 w-3" /> No opaque AI score. Each quote's status is
          derived, not guessed.
        </p>
      </div>

      <Sheet open={!!drawer} onOpenChange={(v) => !v && setDrawer(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg">
          {drawer && (
            <>
              <SheetHeader>
                <SheetTitle className="mono uppercase tracking-widest text-lime text-xs">
                  Evidence · {drawer.field.replace(/_/g, " ")}
                </SheetTitle>
                <SheetDescription>{shops[drawer.quote.shopId]?.name}</SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-3 px-4 pb-6">
                {evidenceAll
                  .filter((e) => e.callId === drawer.quote.callId && e.fieldName === drawer.field)
                  .map((e) => (
                    <div key={e.id} className="hairline rounded-md bg-background/40 p-3">
                      <div className="mono flex items-center justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
                        <span>{e.speaker}</span>
                        <span className="text-lime">
                          {Math.floor(e.timeSeconds / 60)}:
                          {(e.timeSeconds % 60).toString().padStart(2, "0")}
                        </span>
                      </div>
                      <p className="mt-1 text-sm">"{e.transcriptText}"</p>
                      {calls[e.callId]?.providerConversationId && (
                        <Button asChild size="sm" variant="secondary" className="mt-2">
                          <a
                            href={`/api/calls/${encodeURIComponent(e.callId)}/audio#t=${Math.floor(e.timeSeconds)}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Play className="mr-2 h-3 w-3" /> Play recording
                          </a>
                        </Button>
                      )}
                    </div>
                  ))}
                {evidenceAll.filter(
                  (e) => e.callId === drawer.quote.callId && e.fieldName === drawer.field,
                ).length === 0 && (
                  <div className="text-sm text-muted-foreground">
                    No transcript-level evidence recorded for this field.
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}

function item(q: Quote, category: string, nullIfMissing = false) {
  const it = q.items.find((i) => i.category === category);
  if (!it) return nullIfMissing ? null : "—";
  return money(it.amount);
}

function SortToggle({
  sortKey,
  setSortKey,
  k,
  label,
}: {
  sortKey: SortKey;
  setSortKey: (k: SortKey) => void;
  k: SortKey;
  label: string;
}) {
  const active = sortKey === k;
  return (
    <button
      onClick={() => setSortKey(k)}
      className={cn(
        "mono flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs uppercase tracking-widest",
        active
          ? "border-lime bg-lime/10 text-lime"
          : "border-border text-muted-foreground hover:bg-secondary",
      )}
    >
      <ArrowUpDown className="h-3 w-3" /> Sort · {label}
    </button>
  );
}
