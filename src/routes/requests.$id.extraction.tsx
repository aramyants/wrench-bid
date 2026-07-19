import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/wrenchbid/AppShell";
import { useWrenchStore } from "@/lib/wrenchbid/store";
import { EvidenceField } from "@/components/wrenchbid/EvidenceField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useMemo, useState } from "react";
import { ArrowRight, FileText, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";
import { useRequestSync } from "@/hooks/use-live-sync";
import { updateRepairSpec } from "@/lib/wrenchbid/api";
import type { RepairSpec } from "@/lib/wrenchbid/types";

export const Route = createFileRoute("/requests/$id/extraction")({
  head: () => ({
    meta: [
      { title: "Extracted repair details — WrenchBid" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ExtractionPage,
});

function ExtractionPage() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const specs = useWrenchStore((s) => s.specs);
  const session = useWrenchStore((s) => s.sessions[id]);
  const documentsBySession = useWrenchStore((s) => s.documents);
  const documents = documentsBySession[id] ?? [];
  const audit = useWrenchStore((s) => s.audit);
  const correctMileage = useWrenchStore((s) => s.correctMileage);
  const setSpec = useWrenchStore((s) => s.setSpec);
  const sync = useRequestSync(id);

  const spec = useMemo(() => Object.values(specs).find((s) => s.sessionId === id), [id, specs]);

  const [editingMileage, setEditingMileage] = useState(false);
  const [mileageDraft, setMileageDraft] = useState<string>("");
  const [saveError, setSaveError] = useState<string>();

  if (!spec) {
    return (
      <AppShell>
        <div className="mx-auto max-w-md text-center">
          <h1 className="text-2xl font-semibold">Extraction unavailable</h1>
          <p className="mt-2 text-muted-foreground">
            {sync.loading
              ? "Loading the secure request…"
              : (sync.error ?? "No draft spec was found for this session.")}
          </p>
          <Link to="/requests/new" className="mt-4 inline-block text-lime underline">
            Start a new request
          </Link>
        </div>
      </AppShell>
    );
  }

  const sessionAudit = audit
    .filter((a) => a.sessionId === spec.sessionId)
    .slice(-4)
    .reverse();
  const missing = Object.entries(spec.fieldMeta).filter(([, m]) => m.status === "missing");

  return (
    <AppShell>
      <div className="mono mb-2 text-xs uppercase tracking-widest text-lime">
        Step 2 · Extraction
      </div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Extracted repair details</h1>
          <p className="mt-1 text-muted-foreground">
            Verify each field. Sources and confidence are shown alongside each value.
          </p>
        </div>
        <Button
          onClick={() => nav({ to: "/requests/$id/intake", params: { id: spec.sessionId } })}
          className="bg-lime text-lime-foreground hover:brightness-95"
        >
          Continue to voice interview <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        {/* Source document */}
        <div className="hairline rounded-xl bg-surface/60 p-5">
          {session?.mode === "live" ? (
            <div>
              <div className="mono mb-4 flex items-center justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
                <span>
                  <FileText className="mr-1 inline h-3 w-3" />{" "}
                  {documents[0]?.originalName ?? "Secure PDF"}
                </span>
                <span className="text-verified">server extracted</span>
              </div>
              <div className="rounded-lg border border-verified/30 bg-verified/5 p-5">
                <ShieldCheck className="h-7 w-7 text-verified" />
                <h2 className="mt-3 font-semibold">Private source retained</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  The original PDF is stored outside the public directory with a content hash. Raw
                  document text is never sent back to the browser.
                </p>
                <dl className="mono mt-4 space-y-2 text-xs text-muted-foreground">
                  <div className="flex justify-between gap-4">
                    <dt>Size</dt>
                    <dd>{documents[0] ? `${Math.ceil(documents[0].sizeBytes / 1024)} KB` : "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>SHA-256</dt>
                    <dd className="max-w-56 truncate" title={documents[0]?.sha256}>
                      {documents[0]?.sha256 ?? "—"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>Status</dt>
                    <dd>{documents[0]?.extractionStatus ?? "loading"}</dd>
                  </div>
                </dl>
              </div>
            </div>
          ) : (
            <DemoDocument />
          )}
        </div>

        {/* Extracted fields */}
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <EvidenceField
              label="Year"
              value={spec.vehicle.year}
              meta={spec.fieldMeta["vehicle.year"]}
              mono
            />
            <EvidenceField
              label="Make"
              value={spec.vehicle.make}
              meta={spec.fieldMeta["vehicle.make"]}
            />
            <EvidenceField
              label="Model"
              value={spec.vehicle.model}
              meta={spec.fieldMeta["vehicle.model"]}
            />
            <EvidenceField
              label="Trim"
              value={spec.vehicle.trim ?? "—"}
              meta={spec.fieldMeta["vehicle.trim"]}
            />
            <EvidenceField
              label="Mileage"
              value={
                editingMileage ? (
                  <div className="flex items-center gap-2">
                    <Input
                      className="mono w-32"
                      autoFocus
                      value={mileageDraft || spec.vehicle.mileage.toString()}
                      onChange={(e) => setMileageDraft(e.target.value.replace(/[^0-9]/g, ""))}
                    />
                    <Button
                      size="sm"
                      onClick={async () => {
                        const n = parseInt(mileageDraft || "0", 10);
                        if (n > 0) {
                          correctMileage(spec.id, n);
                          if (session?.mode === "live") {
                            try {
                              setSpec(await updateRepairSpec(id, "vehicle.mileage", n, "manual"));
                            } catch (reason) {
                              setSaveError(
                                reason instanceof Error ? reason.message : "Mileage was not saved",
                              );
                            }
                          }
                        }
                        setEditingMileage(false);
                      }}
                      className="bg-lime text-lime-foreground hover:brightness-95"
                    >
                      Save
                    </Button>
                  </div>
                ) : (
                  spec.vehicle.mileage.toLocaleString()
                )
              }
              meta={spec.fieldMeta["vehicle.mileage"]}
              onEdit={() => {
                setEditingMileage(true);
                setMileageDraft("");
              }}
              mono
            />
            <EvidenceField
              label="VIN (last 8)"
              value={spec.vehicle.vinLast8}
              meta={spec.fieldMeta["vehicle.vinLast8"]}
              mono
            />
          </div>
          <EvidenceField
            label="Requested operations"
            value={
              <ul className="text-base font-normal">
                {spec.operations.map((o) => (
                  <li key={o.id}>• {o.description}</li>
                ))}
              </ul>
            }
            meta={spec.fieldMeta["operations"]}
          />

          {session?.mode === "live" && (
            <ManualSpecEditor spec={spec} onSaved={setSpec} onError={setSaveError} />
          )}

          {saveError && (
            <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
              {saveError}
            </div>
          )}
          <EvidenceField
            label="Location"
            value={`${spec.location.city}, ${spec.location.region} ${spec.location.postal}`}
            meta={spec.fieldMeta["location"]}
          />

          {missing.length > 0 && (
            <div className="hairline rounded-xl border-amber/40 bg-amber/5 p-4">
              <div className="mono mb-2 text-[10px] uppercase tracking-widest text-amber">
                Missing fields · {missing.length}
              </div>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {missing.map(([k]) => (
                  <li key={k}>• {k}</li>
                ))}
              </ul>
              <div className="mt-2 text-xs text-muted-foreground">
                These will be filled during the voice interview.
              </div>
            </div>
          )}

          {sessionAudit.length > 0 && (
            <div className="hairline rounded-xl bg-surface/40 p-4">
              <div className="mono mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                Audit trail
              </div>
              <ul className="space-y-1 text-sm">
                {sessionAudit.map((a) => (
                  <motion.li
                    key={a.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-muted-foreground"
                  >
                    <span className="mono text-xs text-lime">{a.eventType}</span> — {a.message}
                  </motion.li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function DemoDocument() {
  return (
    <>
      <div className="mono mb-3 flex items-center justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
        <span>
          <FileText className="mr-1 inline h-3 w-3" /> sample_estimate.pdf · page 1/1
        </span>
        <span className="text-amber">synthetic</span>
      </div>
      <div className="rounded-md bg-[oklch(0.97_0.01_85)] p-6 text-[oklch(0.16_0.02_250)]">
        <div className="mono text-[10px] uppercase tracking-widest text-neutral-500">
          Charlotte Toyota Service · Estimate #A-19842
        </div>
        <div className="mt-2 text-lg font-semibold">2020 TOYOTA CAMRY SE</div>
        <div className="mono text-xs text-neutral-600">
          VIN ...12345678 · ODOMETER: <mark className="rounded bg-amber/50 px-1">52,000 mi</mark>{" "}
          (partial reading)
        </div>
        <hr className="my-3 border-neutral-300" />
        <div className="mono text-[11px] uppercase tracking-wider text-neutral-500">
          Recommended service
        </div>
        <ul className="mt-1 space-y-1 text-sm">
          <li>
            <mark className="rounded bg-lime/40 px-1">R&R FRONT BRAKE PADS</mark> — premium
            aftermarket
          </li>
          <li>
            <mark className="rounded bg-lime/40 px-1">R&R FRONT BRAKE ROTORS</mark> — premium
            aftermarket
          </li>
        </ul>
        <hr className="my-3 border-neutral-300" />
        <div className="flex justify-between text-sm">
          <span>Parts + labor (est.)</span>
          <span className="mono">$780.00</span>
        </div>
        <div className="mono mt-4 text-[10px] text-neutral-500">
          CHARLOTTE, NC 28202 · valid 7 days
        </div>
      </div>
    </>
  );
}

function ManualSpecEditor({
  spec,
  onSaved,
  onError,
}: {
  spec: RepairSpec;
  onSaved: (spec: RepairSpec) => void;
  onError: (message?: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState(() => ({
    year: String(spec.vehicle.year || ""),
    make: spec.vehicle.make,
    model: spec.vehicle.model,
    trim: spec.vehicle.trim ?? "",
    mileage: String(spec.vehicle.mileage || ""),
    vinLast8: spec.vehicle.vinLast8,
    city: spec.location.city,
    region: spec.location.region,
    postal: spec.location.postal,
    completionByDays: String(spec.completionByDays || 7),
    operations: spec.operations.map((operation) => operation.description).join("\n"),
  }));

  function field(key: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setSaving(true);
    onError(undefined);
    try {
      const operations = values.operations
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((description) => ({
          id: crypto.randomUUID(),
          description,
          partsPreference: "any" as const,
          customerSuppliedParts: false,
        }));
      const updates: Array<[string, unknown]> = [
        ["vehicle.year", Number(values.year)],
        ["vehicle.make", values.make],
        ["vehicle.model", values.model],
        ["vehicle.trim", values.trim],
        ["vehicle.mileage", Number(values.mileage)],
        ["vehicle.vinLast8", values.vinLast8],
        ["location.city", values.city],
        ["location.region", values.region.toUpperCase()],
        ["location.postal", values.postal],
        ["completionByDays", Number(values.completionByDays)],
        ["operations", operations],
      ];
      let latest = spec;
      for (const [path, value] of updates) {
        latest = await updateRepairSpec(spec.sessionId, path, value, "manual");
      }
      onSaved(latest);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "The RepairSpec could not be saved");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="hairline rounded-xl bg-surface/60 p-4">
      <div className="mono mb-3 text-[10px] uppercase tracking-widest text-lime">
        Manual confirmation fallback
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          value={values.year}
          onChange={(event) => field("year", event.target.value.replace(/\D/g, ""))}
          placeholder="Year"
          aria-label="Vehicle year"
        />
        <Input
          value={values.make}
          onChange={(event) => field("make", event.target.value)}
          placeholder="Make"
          aria-label="Vehicle make"
        />
        <Input
          value={values.model}
          onChange={(event) => field("model", event.target.value)}
          placeholder="Model"
          aria-label="Vehicle model"
        />
        <Input
          value={values.trim}
          onChange={(event) => field("trim", event.target.value)}
          placeholder="Trim (optional)"
          aria-label="Vehicle trim"
        />
        <Input
          value={values.mileage}
          onChange={(event) => field("mileage", event.target.value.replace(/\D/g, ""))}
          placeholder="Current mileage"
          aria-label="Current mileage"
        />
        <Input
          value={values.vinLast8}
          maxLength={8}
          onChange={(event) => field("vinLast8", event.target.value.toUpperCase())}
          placeholder="VIN last 8"
          aria-label="VIN last eight"
        />
        <Input
          value={values.city}
          onChange={(event) => field("city", event.target.value)}
          placeholder="City"
          aria-label="City"
        />
        <div className="grid grid-cols-[1fr_1.4fr] gap-2">
          <Input
            value={values.region}
            maxLength={2}
            onChange={(event) => field("region", event.target.value)}
            placeholder="State"
            aria-label="State"
          />
          <Input
            value={values.postal}
            maxLength={10}
            onChange={(event) => field("postal", event.target.value)}
            placeholder="Postal"
            aria-label="Postal code"
          />
        </div>
      </div>
      <Textarea
        className="mt-3"
        value={values.operations}
        onChange={(event) => field("operations", event.target.value)}
        placeholder="One requested repair operation per line"
        aria-label="Repair operations"
      />
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Use this when voice intake is unavailable. Saving records every confirmed field in the
          audit trail.
        </p>
        <Button size="sm" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save confirmed fields"}
        </Button>
      </div>
    </div>
  );
}
