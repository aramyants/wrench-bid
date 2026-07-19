import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/wrenchbid/AppShell";
import { useWrenchStore } from "@/lib/wrenchbid/store";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { EvidenceField } from "@/components/wrenchbid/EvidenceField";
import { Pill } from "@/components/wrenchbid/StatusPill";
import { shortHash } from "@/lib/wrenchbid/format";
import { Lock, ArrowRight, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useRequestSync } from "@/hooks/use-live-sync";

export const Route = createFileRoute("/requests/$id/spec")({
  head: () => ({
    meta: [{ title: "RepairSpec review — WrenchBid" }, { name: "robots", content: "noindex" }],
  }),
  component: SpecReview,
});

function SpecReview() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const specs = useWrenchStore((s) => s.specs);
  const confirmSpec = useWrenchStore((s) => s.confirmSpec);
  const sync = useRequestSync(id);
  const spec = useMemo(() => Object.values(specs).find((s) => s.sessionId === id), [id, specs]);
  const [confirming, setConfirming] = useState(false);

  if (!spec) {
    return (
      <AppShell>
        <div className="mx-auto max-w-md py-16 text-center text-muted-foreground">
          {sync.loading
            ? "Loading the secure RepairSpec…"
            : (sync.error ?? "RepairSpec not found.")}
        </div>
      </AppShell>
    );
  }
  const isConfirmed = spec.status === "confirmed";

  async function onConfirm() {
    if (!spec) return;
    setConfirming(true);
    try {
      await confirmSpec(spec.id);
      toast.success("Spec confirmed — version " + spec.version + " frozen");
      nav({ to: "/requests/$id/shops", params: { id: spec.sessionId } });
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "RepairSpec confirmation failed");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <AppShell>
      <div className="mono mb-2 text-xs uppercase tracking-widest text-lime">
        Step 4 · RepairSpec
      </div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Review your RepairSpec</h1>
          <p className="mt-1 text-muted-foreground">
            This is the exact specification we'll send to every shop. Once confirmed, the version is
            immutable.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Pill
            tone={isConfirmed ? "verified" : "amber"}
            icon={isConfirmed ? <ShieldCheck className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
          >
            {isConfirmed ? "Confirmed" : "Draft"}
          </Pill>
          <Pill tone="muted">v{spec.version}</Pill>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <SpecCard title="Vehicle">
          <Row k="Year" v={spec.vehicle.year} mono />
          <Row
            k="Make / Model"
            v={`${spec.vehicle.make} ${spec.vehicle.model} ${spec.vehicle.trim ?? ""}`}
          />
          <Row k="Mileage" v={spec.vehicle.mileage.toLocaleString()} mono />
          <Row k="VIN (last 8)" v={"••••••" + spec.vehicle.vinLast8.slice(-4)} mono />
        </SpecCard>

        <SpecCard title="Diagnosis source">
          <Row k="Source" v={spec.diagnosisSource} />
          <Row k="Confirmed" v={isConfirmed ? "Yes" : "Pending confirmation"} />
        </SpecCard>

        <SpecCard title="Requested operations">
          <ul className="space-y-1">
            {spec.operations.map((o) => (
              <li key={o.id} className="flex justify-between text-sm">
                <span>{o.description}</span>
                <span className="mono text-xs text-muted-foreground">
                  {o.partsPreference.replace(/_/g, " ")}
                </span>
              </li>
            ))}
          </ul>
        </SpecCard>

        <SpecCard title="Constraints">
          <Row
            k="Location"
            v={`${spec.location.city}, ${spec.location.region} ${spec.location.postal}`}
          />
          <Row k="Complete within" v={`${spec.completionByDays} days`} mono />
          <Row k="Customer-supplied parts" v="None" />
        </SpecCard>

        <div className="md:col-span-2">
          <SpecCard title="Required quote fields">
            <div className="flex flex-wrap gap-1.5">
              {spec.requiredQuoteFields.map((f) => (
                <span
                  key={f}
                  className="mono rounded-full border border-border bg-background/40 px-2 py-0.5 text-[11px] uppercase tracking-wider text-muted-foreground"
                >
                  {f.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          </SpecCard>
        </div>

        <div className="md:col-span-2 hairline rounded-xl bg-surface/50 p-5">
          <div className="mono mb-2 text-[10px] uppercase tracking-widest text-lime">
            Spec integrity
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Row k="Version" v={"v" + spec.version} mono />
            <Row
              k="Confirmed at"
              v={spec.confirmedAt ? new Date(spec.confirmedAt).toLocaleString() : "—"}
              mono
            />
            <Row
              k="Spec hash"
              v={
                <span className="mono" title={spec.specHash}>
                  {shortHash(spec.specHash)}
                </span>
              }
            />
          </div>
        </div>

        <div className="md:col-span-2">
          <EvidenceField
            label="Mileage"
            value={spec.vehicle.mileage.toLocaleString()}
            meta={spec.fieldMeta["vehicle.mileage"]}
          />
        </div>
      </div>

      <div className="mt-8 flex flex-wrap justify-end gap-2">
        {!isConfirmed && (
          <Button
            variant="secondary"
            onClick={() => nav({ to: "/requests/$id/extraction", params: { id: spec.sessionId } })}
          >
            Edit
          </Button>
        )}
        {!isConfirmed ? (
          <Button
            className="bg-lime text-lime-foreground hover:brightness-95"
            onClick={onConfirm}
            disabled={confirming}
          >
            {confirming ? "Sealing…" : "Confirm RepairSpec"} <Lock className="ml-2 h-4 w-4" />
          </Button>
        ) : (
          <Button
            className="bg-lime text-lime-foreground hover:brightness-95"
            onClick={() => nav({ to: "/requests/$id/shops", params: { id: spec.sessionId } })}
          >
            Continue to shop selection <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        )}
      </div>
    </AppShell>
  );
}

function SpecCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="hairline rounded-xl bg-surface/60 p-5">
      <div className="mono mb-3 text-[10px] uppercase tracking-widest text-lime">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={mono ? "mono" : ""}>{v}</dd>
    </div>
  );
}
