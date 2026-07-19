import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/wrenchbid/AppShell";
import { useWrenchStore } from "@/lib/wrenchbid/store";
import { seedShops } from "@/lib/wrenchbid/seed";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Phone, MapPin, Globe, ChevronDown, PlayCircle, ShieldCheck } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { Shop } from "@/lib/wrenchbid/types";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { useRequestSync } from "@/hooks/use-live-sync";
import {
  addManualShop,
  createRemoteCampaign,
  discoverShops,
  verifyShopPhone,
} from "@/lib/wrenchbid/api";
import { E164_PHONE_PATTERN } from "@/lib/wrenchbid/phone";

export const Route = createFileRoute("/requests/$id/shops")({
  head: () => ({
    meta: [{ title: "Select shops — WrenchBid" }, { name: "robots", content: "noindex" }],
  }),
  component: ShopSelect,
});

function ShopSelect() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const shops = useWrenchStore((s) => s.shops);
  const session = useWrenchStore((s) => s.sessions[id]);
  const shopIdsBySession = useWrenchStore((s) => s.shopIdsBySession);
  const requestShopIds = shopIdsBySession[id] ?? [];
  const specs = useWrenchStore((s) => s.specs);
  const createCampaign = useWrenchStore((s) => s.createCampaign);
  const mergeCampaign = useWrenchStore((s) => s.mergeCampaignSnapshot);
  const addShopsToSession = useWrenchStore((s) => s.addShopsToSession);
  const sync = useRequestSync(id);
  const spec = useMemo(() => Object.values(specs).find((s) => s.sessionId === id), [id, specs]);
  const seeded = seedShops.map((s) => shops[s.id] ?? s);
  const available =
    session?.mode === "demo"
      ? seeded
      : requestShopIds.map((shopId) => shops[shopId]).filter((shop): shop is Shop => Boolean(shop));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string>();
  const [aiDisclosure, setAiDisclosure] = useState(false);
  const [recordingConsent, setRecordingConsent] = useState(false);
  const [manual, setManual] = useState({
    name: "",
    phone: "+1",
    address: "",
    website: "",
    phoneVerificationAttested: false,
  });
  const campaignIdempotencyKey = useRef(crypto.randomUUID());
  const hasInvalidLiveSelection =
    session?.mode === "live" &&
    Array.from(selected).some((shopId) => {
      const shop = shops[shopId];
      return !shop?.phoneVerified || !E164_PHONE_PATTERN.test(shop.phone);
    });

  useEffect(() => {
    if (session?.mode === "demo") setSelected(new Set(seedShops.map((shop) => shop.id)));
  }, [session?.mode]);

  function toggle(sid: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      return next;
    });
  }

  async function launch() {
    if (!spec) return;
    if (session?.mode === "live") {
      if (hasInvalidLiveSelection) {
        setError("Every selected shop needs an explicitly verified E.164 phone number");
        return;
      }
      setLaunching(true);
      setError(undefined);
      try {
        const snapshot = await createRemoteCampaign({
          sessionId: spec.sessionId,
          shopIds: Array.from(selected),
          idempotencyKey: campaignIdempotencyKey.current,
          aiDisclosureAccepted: aiDisclosure as true,
          recordingConsentConfirmed: recordingConsent as true,
        });
        mergeCampaign(snapshot);
        nav({ to: "/campaigns/$id", params: { id: snapshot.campaign.id } });
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "The call campaign could not start");
      } finally {
        setLaunching(false);
      }
      return;
    }
    const campaignId = createCampaign(spec.sessionId, spec.id, Array.from(selected));
    nav({ to: "/campaigns/$id", params: { id: campaignId } });
  }

  async function search() {
    if (!query.trim()) return;
    setSearching(true);
    setError(undefined);
    try {
      const discovered = await discoverShops(id, query);
      addShopsToSession(id, discovered);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Shop discovery failed");
    } finally {
      setSearching(false);
    }
  }

  async function addShop() {
    if (!manual.phoneVerificationAttested) return;
    setError(undefined);
    try {
      const shop = await addManualShop(id, {
        ...manual,
        phoneVerificationAttested: true,
      });
      addShopsToSession(id, [shop]);
      setManual({
        name: "",
        phone: "+1",
        address: "",
        website: "",
        phoneVerificationAttested: false,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The shop could not be added");
    }
  }

  async function verifyPhone(shopId: string, phone: string) {
    setError(undefined);
    try {
      const shop = await verifyShopPhone(id, {
        shopId,
        phone,
        phoneVerificationAttested: true,
      });
      addShopsToSession(id, [shop]);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "The phone could not be verified";
      setError(message);
      throw reason;
    }
  }

  if (!spec) {
    return (
      <AppShell>
        <div className="mx-auto max-w-md py-16 text-center text-muted-foreground">
          {sync.loading ? "Loading shops…" : (sync.error ?? "Request not found.")}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mono mb-2 text-xs uppercase tracking-widest text-lime">Step 5 · Shops</div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Choose three repair shops</h1>
          <p className="mt-1 text-muted-foreground">
            WrenchBid will call each shop using the identical confirmed RepairSpec.
          </p>
        </div>
        <Button
          disabled={
            selected.size < 3 ||
            launching ||
            hasInvalidLiveSelection ||
            (session?.mode === "live" && (!aiDisclosure || !recordingConsent))
          }
          className="bg-lime text-lime-foreground hover:brightness-95 disabled:opacity-40"
          onClick={() => void launch()}
        >
          <PlayCircle className="mr-2 h-4 w-4" />{" "}
          {launching ? "Starting real calls…" : `Start call campaign (${selected.size})`}
        </Button>
      </div>

      <Tabs key={session?.mode} defaultValue={session?.mode === "live" ? "live" : "demo"}>
        <TabsList>
          {session?.mode === "demo" && <TabsTrigger value="demo">Demo counterparties</TabsTrigger>}
          <TabsTrigger value="live">Live discovery</TabsTrigger>
        </TabsList>

        <TabsContent value="demo" className="mt-4">
          <div className="grid gap-3 md:grid-cols-3">
            {seeded.map((s) => (
              <ShopCard
                key={s.id}
                shop={s}
                selected={selected.has(s.id)}
                onToggle={() => toggle(s.id)}
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="live" className="mt-4">
          <div className="hairline rounded-xl bg-surface/60 p-6">
            <div className="mono mb-2 text-[10px] uppercase tracking-widest text-lime">
              Live business discovery
            </div>
            <p className="text-sm text-muted-foreground">
              Tavily finds candidate business pages. Web results are untrusted leads: verify each
              phone number before a call. You can also add a known shop manually.
            </p>
            <div className="mt-4 flex gap-2">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Repair shops for ${spec.operations[0]?.description ?? "this repair"} near ${spec.location.postal}`}
              />
              <Button
                variant="secondary"
                disabled={searching || query.trim().length < 5}
                onClick={() => void search()}
              >
                {searching ? "Searching…" : "Search"}
              </Button>
            </div>

            {available.length > 0 && (
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                {available.map((shop) => (
                  <ShopCard
                    key={shop.id}
                    shop={shop}
                    selected={selected.has(shop.id)}
                    onToggle={() => toggle(shop.id)}
                    onVerifyPhone={(phone) => verifyPhone(shop.id, phone)}
                  />
                ))}
              </div>
            )}

            <div className="mt-6 border-t border-border pt-5">
              <div className="mono mb-3 text-[10px] uppercase tracking-widest text-muted-foreground">
                Add a verified shop manually
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <Input
                  value={manual.name}
                  onChange={(event) =>
                    setManual((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="Business name"
                />
                <Input
                  type="tel"
                  autoComplete="tel"
                  value={manual.phone}
                  onChange={(event) =>
                    setManual((current) => ({ ...current, phone: event.target.value }))
                  }
                  placeholder="+17045551234"
                />
                <Input
                  value={manual.address}
                  onChange={(event) =>
                    setManual((current) => ({ ...current, address: event.target.value }))
                  }
                  placeholder="Street address"
                />
                <Input
                  value={manual.website}
                  onChange={(event) =>
                    setManual((current) => ({ ...current, website: event.target.value }))
                  }
                  placeholder="https://… (optional)"
                />
              </div>
              <label className="mt-3 flex max-w-2xl items-start gap-3 rounded-lg border border-amber/30 bg-amber/5 p-3 text-sm">
                <Checkbox
                  checked={manual.phoneVerificationAttested}
                  onCheckedChange={(value) =>
                    setManual((current) => ({
                      ...current,
                      phoneVerificationAttested: Boolean(value),
                    }))
                  }
                  className="mt-0.5"
                />
                <span>
                  I checked this business number and re-entered it in E.164 format. I understand
                  WrenchBid may call this exact number.
                </span>
              </label>
              <Button
                className="mt-3"
                variant="secondary"
                disabled={
                  !manual.name ||
                  !E164_PHONE_PATTERN.test(manual.phone) ||
                  !manual.address ||
                  !manual.phoneVerificationAttested
                }
                onClick={() => void addShop()}
              >
                Add verified shop
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {session?.mode === "live" && (
        <div className="mt-6 hairline rounded-xl border-amber/30 bg-amber/5 p-5">
          <div className="mono mb-3 text-[10px] uppercase tracking-widest text-amber">
            Required before dialing
          </div>
          <label className="mb-3 flex items-start gap-3 text-sm">
            <Checkbox
              checked={aiDisclosure}
              onCheckedChange={(value) => setAiDisclosure(Boolean(value))}
              className="mt-0.5"
            />
            <span>
              I authorize WrenchBid to call the selected businesses on my behalf. The agent must
              identify itself as AI when asked and must not invent scope or leverage.
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <Checkbox
              checked={recordingConsent}
              onCheckedChange={(value) => setRecordingConsent(Boolean(value))}
              className="mt-0.5"
            />
            <span>
              I have checked the calling/recording-consent rules that apply to the selected numbers
              and authorize recording for quote evidence.
            </span>
          </label>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      )}
    </AppShell>
  );
}

function ShopCard({
  shop,
  selected,
  onToggle,
  onVerifyPhone,
}: {
  shop: Shop;
  selected: boolean;
  onToggle: () => void;
  onVerifyPhone?: (phone: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [verificationPhone, setVerificationPhone] = useState("");
  const [verificationAttested, setVerificationAttested] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verificationError, setVerificationError] = useState<string>();
  const callable =
    shop.phoneVerified && (shop.discoverySource === "seed" || E164_PHONE_PATTERN.test(shop.phone));

  async function verify() {
    if (!onVerifyPhone || !verificationAttested || !E164_PHONE_PATTERN.test(verificationPhone))
      return;
    setVerifying(true);
    setVerificationError(undefined);
    try {
      await onVerifyPhone(verificationPhone);
      setVerificationPhone("");
      setVerificationAttested(false);
    } catch (reason) {
      setVerificationError(
        reason instanceof Error ? reason.message : "The phone could not be verified",
      );
    } finally {
      setVerifying(false);
    }
  }
  return (
    <div
      className={cn(
        "hairline rounded-xl bg-surface/60 p-4 transition",
        selected && "ring-1 ring-lime/60 bg-lime/5",
      )}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="font-semibold">{shop.name}</div>
          <div className="mono mt-1 text-[10px] uppercase tracking-widest text-muted-foreground">
            {shop.discoverySource}
          </div>
        </div>
        <button
          onClick={onToggle}
          disabled={!callable}
          className={cn(
            "mono rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-widest",
            selected
              ? "border-lime bg-lime text-lime-foreground"
              : "border-border text-muted-foreground hover:bg-secondary",
            !callable && "cursor-not-allowed opacity-50",
          )}
        >
          {!shop.phoneVerified
            ? "Phone unverified"
            : !callable
              ? "Invalid phone"
              : selected
                ? "Selected"
                : "Select"}
        </button>
      </div>
      <dl className="mt-3 space-y-1.5 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <Phone className="h-3.5 w-3.5" />{" "}
          <span className="mono">
            {shop.phone || "Not found"} {shop.phoneVerified ? "· verified" : "· candidate"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <MapPin className="h-3.5 w-3.5" /> {shop.address}
        </div>
        {shop.website && (
          <div className="flex items-center gap-2">
            <Globe className="h-3.5 w-3.5" /> {shop.website}
          </div>
        )}
        {shop.hours && <div className="text-xs">{shop.hours}</div>}
      </dl>
      {!shop.phoneVerified && onVerifyPhone && (
        <div className="mt-4 rounded-lg border border-amber/35 bg-background/50 p-3">
          <div className="flex items-center gap-2 text-xs font-medium text-amber">
            <ShieldCheck className="h-4 w-4" /> Verify before selection
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            Check an official business source, then re-enter the exact number. Search results are
            leads, not verified call destinations.
          </p>
          <Input
            className="mt-3"
            type="tel"
            autoComplete="off"
            value={verificationPhone}
            onChange={(event) => setVerificationPhone(event.target.value)}
            placeholder={shop.phone || "+17045551234"}
            aria-label={`Verified E.164 phone for ${shop.name}`}
          />
          <label className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={verificationAttested}
              onCheckedChange={(value) => setVerificationAttested(Boolean(value))}
              className="mt-0.5"
            />
            <span>I checked this business number and authorize this exact call destination.</span>
          </label>
          <Button
            className="mt-3 w-full"
            size="sm"
            variant="secondary"
            disabled={
              verifying || !verificationAttested || !E164_PHONE_PATTERN.test(verificationPhone)
            }
            onClick={() => void verify()}
          >
            <ShieldCheck className="mr-2 h-3.5 w-3.5" />
            {verifying ? "Saving verification…" : "Verify exact number"}
          </Button>
          {verificationError && <p className="mt-2 text-xs text-danger">{verificationError}</p>}
        </div>
      )}
      {shop.demoPolicy && (
        <Collapsible open={open} onOpenChange={setOpen} className="mt-3">
          <CollapsibleTrigger className="mono flex w-full items-center justify-between rounded-md border border-amber/30 bg-amber/5 px-2 py-1 text-[10px] uppercase tracking-widest text-amber">
            Demo policy · {shop.demoPolicy.label}
            <ChevronDown className={cn("h-3 w-3 transition", open && "rotate-180")} />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 rounded-md bg-background/40 p-2 text-xs text-muted-foreground">
            <ul className="space-y-1">
              {shop.demoPolicy.behaviorNotes.map((n, i) => (
                <li key={i}>• {n}</li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
