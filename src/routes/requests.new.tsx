import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/wrenchbid/AppShell";
import { useRef, useState } from "react";
import { UploadCloud, FileText, Image as ImageIcon, ShieldCheck, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useWrenchStore } from "@/lib/wrenchbid/store";
import { motion } from "framer-motion";
import { uploadRepairEstimate } from "@/lib/wrenchbid/api";
import { DEMO_SESSION_ID } from "@/lib/wrenchbid/seed";

export const Route = createFileRoute("/requests/new")({
  head: () => ({
    meta: [
      { title: "New repair request — WrenchBid" },
      {
        name: "description",
        content: "Upload a text-based PDF dealer or shop estimate for structured extraction.",
      },
    ],
  }),
  component: NewRequest,
});

function NewRequest() {
  const nav = useNavigate();
  const [consent, setConsent] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const ensureSeeded = useWrenchStore((s) => s.ensureSeeded);
  const addAudit = useWrenchStore((s) => s.addAudit);
  const mergeRequestSnapshot = useWrenchStore((s) => s.mergeRequestSnapshot);

  function fakeUpload(sourceLabel: string) {
    if (!consent) {
      setError("Please acknowledge the processing notice before uploading.");
      return;
    }
    setError(null);
    setProgress(0);
    const start = Date.now();
    const timer = setInterval(() => {
      const t = Math.min(1, (Date.now() - start) / 1400);
      setProgress(Math.round(t * 100));
      if (t >= 1) {
        clearInterval(timer);
        ensureSeeded();
        addAudit(DEMO_SESSION_ID, "document_uploaded", `${sourceLabel} uploaded (synthetic)`);
        nav({ to: "/requests/$id/extraction", params: { id: DEMO_SESSION_ID } });
      }
    }, 80);
  }

  async function upload(file: File) {
    if (!consent) {
      setError("Please acknowledge the processing notice before uploading.");
      return;
    }
    if (file.type !== "application/pdf") {
      setError("Live extraction currently accepts text-based PDF estimates only.");
      return;
    }
    if (file.size <= 0 || file.size > 10 * 1024 * 1024) {
      setError("Choose a PDF between 1 byte and 10 MB.");
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const snapshot = await uploadRepairEstimate(file);
      mergeRequestSnapshot(snapshot);
      nav({ to: "/requests/$id/extraction", params: { id: snapshot.session.id } });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The estimate could not be uploaded.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl">
        <div className="mono mb-2 text-xs uppercase tracking-widest text-lime">
          Step 1 · Upload estimate
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Start a repair request</h1>
        <p className="mt-2 text-muted-foreground">
          This is the estimate you already received, not a new quote. WrenchBid turns its repair
          details into a draft scope, the voice interview checks only missing details, and you
          confirm the final scope before any shop call.
        </p>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const file = e.dataTransfer.files[0];
            if (file) void upload(file);
          }}
          onClick={() => !uploading && inputRef.current?.click()}
          onKeyDown={(event) => {
            if ((event.key === "Enter" || event.key === " ") && !uploading)
              inputRef.current?.click();
          }}
          role="button"
          tabIndex={0}
          aria-busy={uploading}
          className={`mt-6 cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime ${drag ? "border-lime bg-lime/5" : "border-border bg-surface/40"}`}
        >
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          {uploading ? (
            <LoaderCircle className="mx-auto h-10 w-10 animate-spin text-lime" />
          ) : (
            <UploadCloud className="mx-auto h-10 w-10 text-lime" />
          )}
          <div className="mt-3 text-lg font-medium">
            {uploading ? "Extracting your estimate…" : "Drop a PDF estimate or choose a file"}
          </div>
          <div className="mono mt-1 text-xs uppercase tracking-widest text-muted-foreground">
            Live extraction: text PDF · up to 10 MB
          </div>
          {progress !== null && (
            <div className="mx-auto mt-4 h-1.5 max-w-sm overflow-hidden rounded-full bg-muted">
              <motion.div
                className="h-full bg-lime"
                animate={{ width: `${progress}%` }}
                transition={{ ease: "linear", duration: 0.05 }}
              />
            </div>
          )}
        </div>

        <div className="mt-4 flex items-start gap-2 text-sm">
          <Checkbox
            id="consent"
            checked={consent}
            onCheckedChange={(v) => setConsent(!!v)}
            className="mt-0.5"
          />
          <label htmlFor="consent" className="text-muted-foreground">
            I consent to WrenchBid securely storing and processing this estimate to extract
            structured repair details. No diagnostic advice is provided and no payment is taken. I
            can permanently delete the request and its derived records.
          </label>
        </div>

        {error && (
          <div className="mt-3 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            {error}
          </div>
        )}

        <div className="mt-8 hairline rounded-xl bg-surface/50 p-5">
          <div className="mono mb-3 text-[10px] uppercase tracking-widest text-lime">
            Try it instantly
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Button
              variant="secondary"
              className="justify-start"
              disabled={uploading}
              onClick={() => fakeUpload("Sample dealer estimate")}
            >
              <FileText className="mr-2 h-4 w-4" /> Use sample dealer estimate
            </Button>
            <Button
              variant="secondary"
              className="justify-start"
              disabled={uploading}
              onClick={() => fakeUpload("Sample inspection image")}
            >
              <ImageIcon className="mr-2 h-4 w-4" /> Use sample inspection image
            </Button>
          </div>
          <p className="mono mt-3 text-[10px] uppercase tracking-widest text-amber">
            <ShieldCheck className="mr-1 inline h-3 w-3" /> All demo data is synthetic
          </p>
        </div>
      </div>
    </AppShell>
  );
}
