import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/wrenchbid/AppShell";
import { motion } from "framer-motion";
import { ArrowRight, Phone, FileText, Scale, ShieldCheck } from "lucide-react";
import { money } from "@/lib/wrenchbid/format";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "WrenchBid — Stop calling repair shops. We call and negotiate." },
      {
        name: "description",
        content:
          "Upload an existing repair estimate. WrenchBid gives every shop the same job, captures complete quotes, exposes hidden fees, and negotiates a stronger deal.",
      },
      { property: "og:title", content: "WrenchBid — Stop calling repair shops." },
      { property: "og:description", content: "One repair. Three shops. One negotiated deal." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <AppShell>
      <section className="relative overflow-hidden">
        <div className="grid gap-10 py-8 md:grid-cols-[1.2fr_1fr] md:gap-16 md:py-14">
          <div>
            <div className="mono mb-4 inline-flex items-center gap-2 rounded-full border border-lime/30 bg-lime/5 px-3 py-1 text-xs uppercase tracking-widest text-lime">
              <span className="h-1.5 w-1.5 rounded-full bg-lime animate-pulse" />
              AI voice agent · already-diagnosed repairs
            </div>
            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="text-4xl font-semibold leading-[1.05] tracking-tight md:text-6xl"
            >
              Stop calling repair shops.
              <br />
              <span className="text-lime">WrenchBid</span> calls and negotiates for you.
            </motion.h1>
            <p className="mt-5 max-w-xl text-base text-muted-foreground md:text-lg">
              Upload an existing repair estimate. WrenchBid gives every shop the same job, captures
              itemized quotes, exposes missing fees, and negotiates a stronger deal — retaining
              available call recordings and transcript evidence.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/requests/new"
                className="inline-flex items-center gap-2 rounded-md bg-lime px-5 py-3 text-sm font-semibold text-lime-foreground shadow-[0_0_0_1px_rgba(0,0,0,0.15),0_10px_30px_-15px_oklch(0.88_0.20_128/0.6)] hover:brightness-95"
              >
                Start a repair request <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/demo"
                className="inline-flex items-center gap-2 rounded-md border border-border bg-secondary px-5 py-3 text-sm font-medium hover:bg-accent"
              >
                Run the agent-to-agent demo
              </Link>
            </div>
            <p className="mono mt-6 text-xs uppercase tracking-wider text-muted-foreground">
              Not a mechanic · Not a marketplace · Not a static estimator
            </p>
          </div>

          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6 }}
            className="hairline rounded-xl bg-surface/70 p-5"
          >
            <div className="mono flex items-center justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
              <span>demo · 2020 Camry SE · Charlotte NC</span>
              <span className="text-amber">synthetic data</span>
            </div>
            <div className="mt-4 space-y-3">
              <Row label="Original estimate" value={money(780)} tone="muted" />
              <Row label="Best complete quote" value={money(616.69)} tone="cobalt" />
              <Row label="Negotiated result" value={money(585)} tone="lime" big />
            </div>
            <div className="mt-4 hairline rounded-md bg-background/60 p-3">
              <div className="mono mb-1 text-[10px] uppercase tracking-widest text-verified">
                Improvement
              </div>
              <div className="mono text-xl">
                −{money(195)} <span className="text-muted-foreground text-sm">(25.0%)</span>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <section className="mt-14 grid gap-4 md:grid-cols-3">
        <Step n="01" icon={<FileText className="h-5 w-5" />} title="Confirm the repair">
          Upload the mechanic's estimate. WrenchBid proposes fields with source excerpts and
          confidence, then confirms missing details in a short voice interview.
        </Step>
        <Step n="02" icon={<Phone className="h-5 w-5" />} title="Let WrenchBid call">
          The agent calls three shops using the identical RepairSpec, capturing itemized quotes and
          attaching transcript evidence when a supported field matches an utterance.
        </Step>
        <Step n="03" icon={<Scale className="h-5 w-5" />} title="Compare and negotiate">
          Normalized comparison exposes hidden fees. You approve a negotiation, and the agent runs
          it against one shop using a verified competing quote.
        </Step>
      </section>

      <section className="mt-14 hairline rounded-xl bg-surface/50 p-6 md:p-8">
        <div className="mono mb-3 text-[10px] uppercase tracking-widest text-lime">
          What WrenchBid will not do
        </div>
        <ul className="grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
          {[
            "Diagnose vehicle problems",
            "Invent competing quotes",
            "Claim a quote is legally binding",
            "Hide unknown or missing fields",
            "Rank non-comparable quotes as equivalent",
            "Call a recording live",
          ].map((x) => (
            <li key={x} className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-verified" /> {x}
            </li>
          ))}
        </ul>
      </section>
    </AppShell>
  );
}

function Row({
  label,
  value,
  tone,
  big,
}: {
  label: string;
  value: string;
  tone: "muted" | "cobalt" | "lime";
  big?: boolean;
}) {
  const color =
    tone === "lime"
      ? "text-lime"
      : tone === "cobalt"
        ? "text-[color:var(--cobalt)]"
        : "text-foreground";
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`mono ${big ? "text-3xl" : "text-lg"} font-semibold ${color}`}>{value}</span>
    </div>
  );
}

function Step({
  n,
  icon,
  title,
  children,
}: {
  n: string;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="hairline rounded-xl bg-surface/60 p-5">
      <div className="mono flex items-center justify-between text-[10px] uppercase tracking-widest text-lime">
        <span>step {n}</span>
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <h3 className="mt-3 text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
