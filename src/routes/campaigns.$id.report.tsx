import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/wrenchbid/AppShell";
import { useWrenchStore, useHydrated } from "@/lib/wrenchbid/store";
import { useMemo } from "react";
import { Pill } from "@/components/wrenchbid/StatusPill";
import { money, shortDate, shortHash } from "@/lib/wrenchbid/format";
import { Button } from "@/components/ui/button";
import {
  Download,
  Copy,
  RefreshCw,
  Trash2,
  FileAudio2,
  ShieldCheck,
  MessageSquareText,
} from "lucide-react";
import { toast } from "sonner";
import type { Quote } from "@/lib/wrenchbid/types";
import { rankQuotes } from "@/lib/wrenchbid/ranking";
import { useCampaignSync } from "@/hooks/use-live-sync";
import { deleteRemoteRequest } from "@/lib/wrenchbid/api";

export const Route = createFileRoute("/campaigns/$id/report")({
  head: () => ({
    meta: [{ title: "Recommended deal — WrenchBid" }, { name: "robots", content: "noindex" }],
  }),
  component: ReportPage,
});

function ReportPage() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const campaign = useWrenchStore((s) => s.campaigns[id]);
  const calls = useWrenchStore((s) => s.calls);
  const quotes = useWrenchStore((s) => s.quotes);
  const shops = useWrenchStore((s) => s.shops);
  const specs = useWrenchStore((s) => s.specs);
  const evidence = useWrenchStore((s) => s.evidence);
  const negotiations = useWrenchStore((s) => s.negotiations);
  const deleteSession = useWrenchStore((s) => s.deleteSession);
  const sync = useCampaignSync(id, false);

  const spec = campaign ? specs[campaign.repairSpecId] : undefined;

  const campaignQuotes = useMemo(() => {
    if (!campaign) return [] as Quote[];
    const quoteCallIds = Object.values(calls)
      .filter((call) => call.campaignId === id && call.kind === "quote")
      .map((c) => c.id);
    const baseline = Object.values(quotes).filter(
      (quote) =>
        quoteCallIds.includes(quote.callId) &&
        quote.status === "complete" &&
        quote.completeness >= 0.9 &&
        quote.confirmedInCall,
    );
    const successfulNegotiations = Object.values(negotiations).filter(
      (negotiation) =>
        negotiation.campaignId === id &&
        negotiation.revisedQuoteId &&
        quotes[negotiation.revisedQuoteId]?.status === "complete" &&
        quotes[negotiation.revisedQuoteId]?.completeness >= 0.9 &&
        quotes[negotiation.revisedQuoteId]?.confirmedInCall,
    );
    const replacedOriginalIds = new Set(
      successfulNegotiations.map((negotiation) => negotiation.originalQuoteId),
    );
    const revised = successfulNegotiations.map(
      (negotiation) => quotes[negotiation.revisedQuoteId as string],
    );
    return [...baseline.filter((quote) => !replacedOriginalIds.has(quote.id)), ...revised];
  }, [calls, quotes, id, campaign, negotiations]);

  const ranking = useMemo(() => rankQuotes(campaignQuotes), [campaignQuotes]);
  const recommendation = ranking[0];
  const recommended = recommendation?.quote;
  const recommendedShop = shops[recommended?.shopId ?? ""];
  const campaignNegotiation = Object.values(negotiations).find(
    (negotiation) =>
      negotiation.campaignId === id && negotiation.revisedQuoteId === recommended?.id,
  );
  const originalQuote = campaignNegotiation
    ? quotes[campaignNegotiation.originalQuoteId]
    : undefined;
  const leverageQuote = campaignNegotiation
    ? quotes[campaignNegotiation.leverageQuoteId]
    : undefined;
  const original = originalQuote?.total;
  const finalTotal = recommended?.total ?? 0;
  const improvement = original != null ? original - finalTotal : 0;

  const campaignCalls = Object.values(calls).filter((c) => c.campaignId === id);

  function download() {
    const callIds = new Set(campaignCalls.map((call) => call.id));
    const payload = {
      generatedAt: new Date().toISOString(),
      campaign,
      spec,
      ranking,
      quotes: campaignQuotes,
      calls: campaignCalls,
      evidence: evidence.filter((item) => callIds.has(item.callId)),
      negotiations: Object.values(negotiations).filter((item) => item.campaignId === id),
      recommended,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wrenchbid-report-${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Report downloaded");
  }

  function copy() {
    if (!recommended || !recommendedShop) return;
    const summary = `WrenchBid recommendation: ${recommendedShop.name}
Final total: ${money(finalTotal)}${original != null && improvement > 0 ? ` (down from ${money(original)})` : ""}
Warranty: ${recommended.warrantyText}
Earliest appointment: ${recommended.earliestDate}
Spec hash: ${spec?.specHash ?? "—"}`;
    navigator.clipboard.writeText(summary);
    toast.success("Summary copied");
  }

  async function del() {
    if (!campaign) return;
    if (!confirm("Delete this session and all derived records?")) return;
    try {
      if (campaign.mode === "live") await deleteRemoteRequest(campaign.sessionId);
      deleteSession(campaign.sessionId);
      nav({ to: "/" });
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "The request could not be deleted");
    }
  }

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

  if (!campaign || !recommended || !recommendedShop) {
    return (
      <AppShell>
        <div className="mx-auto max-w-md text-center">
          <h1 className="text-2xl font-semibold">Report unavailable</h1>
          <p className="mt-2 text-muted-foreground">
            {sync.loading
              ? "Building the evidence-backed report…"
              : (sync.error ?? "No completed comparable quotes were found for this campaign.")}
          </p>
          {campaign && !sync.loading && (
            <div className="mt-5 flex justify-center gap-2">
              <Button variant="secondary" onClick={() => nav({ to: "/requests/new" })}>
                Start another request
              </Button>
              <Button variant="destructive" onClick={del}>
                <Trash2 className="mr-2 h-4 w-4" /> Delete session
              </Button>
            </div>
          )}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      replayLabel={
        campaign.mode === "replay" ? "Recorded demo session — not a live call" : undefined
      }
    >
      <div className="mono mb-2 text-xs uppercase tracking-widest text-lime">
        Step 9 · Recommended deal
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-[1.4fr_1fr]">
        <div className="hairline rounded-xl bg-lime/5 p-6 border-lime/40">
          <div className="mono text-[10px] uppercase tracking-widest text-lime">Recommended</div>
          <h1 className="mt-1 text-4xl font-semibold tracking-tight">{recommendedShop.name}</h1>
          <div className="mono mt-4 flex items-baseline gap-3">
            <span className="text-5xl font-semibold text-lime">{money(finalTotal)}</span>
            {original != null && improvement > 0 && (
              <span className="text-lg text-muted-foreground line-through">{money(original)}</span>
            )}
          </div>
          {original != null && improvement > 0 && (
            <div className="mono mt-1 text-sm text-verified">
              − {money(improvement)} saved ({Math.round((improvement / original) * 100)}%) through
              verified leverage
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Pill tone="verified" icon={<ShieldCheck className="h-3 w-3" />}>
              Warranty · {recommended.warrantyText}
            </Pill>
            <Pill tone="lime">Earliest · {shortDate(recommended.earliestDate)}</Pill>
            {recommended.conditions.length > 0 && (
              <Pill tone="amber">{recommended.conditions.length} condition(s)</Pill>
            )}
          </div>
        </div>

        <div className="hairline rounded-xl bg-surface/60 p-6">
          <div className="mono mb-2 text-[10px] uppercase tracking-widest text-lime">Actions</div>
          <div className="grid gap-2">
            <Button
              onClick={download}
              className="justify-start bg-lime text-lime-foreground hover:brightness-95"
            >
              <Download className="mr-2 h-4 w-4" /> Download report (JSON)
            </Button>
            <Button onClick={copy} variant="secondary" className="justify-start">
              <Copy className="mr-2 h-4 w-4" /> Copy summary
            </Button>
            <Button
              onClick={() => nav({ to: "/requests/new" })}
              variant="secondary"
              className="justify-start"
            >
              <RefreshCw className="mr-2 h-4 w-4" /> Start another request
            </Button>
            <Button onClick={del} variant="destructive" className="justify-start">
              <Trash2 className="mr-2 h-4 w-4" /> Delete session
            </Button>
          </div>
        </div>
      </div>

      <Section title="Why this deal is recommended">
        <ul className="grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
          {(recommendation?.rationale.length
            ? recommendation.rationale
            : ["Lowest risk-adjusted complete total"]
          ).map((reason) => (
            <li key={reason}>• {reason}</li>
          ))}
          <li>
            • Transparent rank {recommendation?.rank} of {ranking.length}; completeness{" "}
            {Math.round(recommended.completeness * 100)}%
          </li>
          {recommendation?.warnings.map((warning) => (
            <li key={warning} className="text-amber">
              • Warning: {warning.replace(/_/g, " ")}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Complete comparison">
        <div className="grid gap-3 md:grid-cols-3">
          {campaignQuotes.map((q) => (
            <div key={q.id} className="hairline rounded-md bg-background/40 p-3">
              <div className="font-medium">{shops[q.shopId]?.name}</div>
              <div className="mono mt-1 text-xl">{money(q.total)}</div>
              <div className="mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {q.warrantyText}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Negotiation result">
        {campaignNegotiation && originalQuote && leverageQuote ? (
          <div className="text-sm text-muted-foreground">
            User-approved asks (
            {campaignNegotiation.asks.map((ask) => ask.replace(/_/g, " ")).join(", ")}) used the
            stored {shops[leverageQuote.shopId]?.name} quote of {money(leverageQuote.total)} as
            leverage. {recommendedShop.name} revised from {money(originalQuote.total)} to{" "}
            <span className="text-lime mono">{money(finalTotal)}</span>.
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            No successful revised offer is attached to the recommended quote. The ranking uses only
            captured terms.
          </div>
        )}
      </Section>

      <Section title="Remaining uncertainty">
        <ul className="text-sm text-muted-foreground">
          {recommended.conditions.length === 0 ? (
            <li>• No open conditions on the recommended quote.</li>
          ) : (
            recommended.conditions.map((c, i) => <li key={i}>• {c}</li>)
          )}
          <li>• Quote expires {shortDate(recommended.validUntil)}.</li>
        </ul>
      </Section>

      <Section title="Recordings & transcripts">
        <div className="grid gap-3 md:grid-cols-3">
          {campaignCalls.map((c) => (
            <div key={c.id} className="hairline rounded-md bg-background/40 p-3">
              <div className="font-medium">{shops[c.shopId]?.name}</div>
              <div className="mono mt-1 flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                {c.audioAvailable && c.providerConversationId && (
                  <a
                    className="inline-flex items-center gap-1 text-lime"
                    href={`/api/calls/${encodeURIComponent(c.id)}/audio`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <FileAudio2 className="h-3 w-3" /> audio
                  </a>
                )}
                <MessageSquareText className="h-3 w-3" /> {c.transcript.length} turns
              </div>
              <div className="mt-2 max-h-28 overflow-y-auto text-xs text-muted-foreground">
                {c.transcript.slice(0, 3).map((t) => (
                  <div key={t.index} className="mb-1">
                    <span className="mono text-lime">{t.speaker}</span> "{t.text}"
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="RepairSpec used for all calls">
        <div className="grid gap-2 text-sm md:grid-cols-3">
          <Row
            k="Vehicle"
            v={`${spec?.vehicle.year} ${spec?.vehicle.make} ${spec?.vehicle.model} ${spec?.vehicle.trim ?? ""}`}
          />
          <Row k="Mileage" v={spec?.vehicle.mileage.toLocaleString()} mono />
          <Row k="Location" v={`${spec?.location.city}, ${spec?.location.region}`} />
          <Row k="Version" v={"v" + (spec?.version ?? 1)} mono />
          <Row
            k="Confirmed"
            v={spec?.confirmedAt ? new Date(spec.confirmedAt).toLocaleString() : "—"}
          />
          <Row k="Spec hash" v={shortHash(spec?.specHash)} mono />
        </div>
      </Section>
    </AppShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 hairline rounded-xl bg-surface/50 p-5">
      <div className="mono mb-3 text-[10px] uppercase tracking-widest text-lime">{title}</div>
      {children}
    </section>
  );
}

function Row({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground text-sm">{k}</dt>
      <dd className={mono ? "mono text-sm" : "text-sm"}>{v}</dd>
    </div>
  );
}
