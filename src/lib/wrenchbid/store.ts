import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  Session,
  RepairSpec,
  Shop,
  Campaign,
  Call,
  Quote,
  EvidenceSpan,
  Negotiation,
  AuditEvent,
  CallStatus,
} from "./types";
import {
  seedSession,
  seedSpec,
  seedShops,
  seedCampaign,
  seedCalls,
  seedQuotes,
  seedEvidence,
  seedNegotiation,
  seedRevisedQuote,
  seedAudit,
  DEMO_SESSION_ID,
  DEMO_SPEC_ID,
  DEMO_CAMPAIGN_ID,
} from "./seed";
import { specHash } from "./hash";
import type { CampaignSnapshot, DocumentSummary, RequestSnapshot } from "./api-types";
import { confirmRemoteRepairSpec } from "./api";

type State = {
  sessions: Record<string, Session>;
  specs: Record<string, RepairSpec>;
  shops: Record<string, Shop>;
  campaigns: Record<string, Campaign>;
  calls: Record<string, Call>;
  quotes: Record<string, Quote>;
  evidence: EvidenceSpan[];
  negotiations: Record<string, Negotiation>;
  audit: AuditEvent[];
  documents: Record<string, DocumentSummary[]>;
  shopIdsBySession: Record<string, string[]>;
  hydrated: boolean;
};

type Actions = {
  ensureSeeded: () => void;
  resetDemo: () => void;
  mergeRequestSnapshot: (snapshot: RequestSnapshot) => void;
  mergeCampaignSnapshot: (snapshot: CampaignSnapshot) => void;
  setSpec: (spec: RepairSpec) => void;
  addShopsToSession: (sessionId: string, shops: Shop[]) => void;
  createSession: (mode?: "demo" | "live") => { sessionId: string; specId: string };
  addAudit: (sessionId: string, eventType: string, message: string) => void;
  correctMileage: (specId: string, next: number) => void;
  updateSpecField: (
    specId: string,
    path: string,
    value: unknown,
    source: "voice" | "manual",
  ) => void;
  confirmSpec: (specId: string) => Promise<void>;
  createCampaign: (sessionId: string, specId: string, shopIds: string[]) => string;
  advanceCall: (callId: string, status?: CallStatus) => void;
  revealHiddenFee: () => void;
  simulateNoAnswer: (callId: string) => void;
  applyNegotiation: (asks: string[]) => void;
  deleteSession: (sessionId: string) => void;
};

const empty = (): Omit<State, "hydrated"> => ({
  sessions: {},
  specs: {},
  shops: {},
  campaigns: {},
  calls: {},
  quotes: {},
  evidence: [],
  negotiations: {},
  audit: [],
  documents: {},
  shopIdsBySession: {},
});

function withSeed(): Omit<State, "hydrated"> {
  const shops = Object.fromEntries(seedShops.map((s) => [s.id, s]));
  const calls = Object.fromEntries(seedCalls.map((c) => [c.id, c]));
  const quotes = Object.fromEntries(seedQuotes.map((q) => [q.id, q]));
  return {
    sessions: { [seedSession.id]: seedSession },
    specs: {
      [seedSpec.id]: {
        ...seedSpec,
        status: "confirmed",
        confirmedAt: seedSpec.createdAt,
        specHash: "pending",
      },
    },
    shops,
    campaigns: { [seedCampaign.id]: seedCampaign },
    calls,
    quotes,
    evidence: seedEvidence,
    negotiations: {},
    audit: seedAudit,
    documents: {},
    shopIdsBySession: { [DEMO_SESSION_ID]: seedShops.map((shop) => shop.id) },
  };
}

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function updatePath(spec: RepairSpec, path: string, value: unknown) {
  if (spec.status === "confirmed") return spec;
  const next = structuredClone(spec);
  const segments = path.split(".");
  let target = next as unknown as Record<string, unknown>;
  for (const segment of segments.slice(0, -1)) {
    const nested = target[segment];
    if (!nested || typeof nested !== "object") return spec;
    target = nested as Record<string, unknown>;
  }
  target[segments.at(-1) as string] = value;
  return next;
}

const CALL_ORDER: CallStatus[] = [
  "queued",
  "ringing",
  "connected",
  "collecting_quote",
  "completed",
];

function demoOnlyState(state: State & Actions) {
  const sessionIds = new Set(
    Object.values(state.sessions)
      .filter((session) => session.mode === "demo")
      .map((session) => session.id),
  );
  const campaignIds = new Set(
    Object.values(state.campaigns)
      .filter((campaign) => sessionIds.has(campaign.sessionId))
      .map((campaign) => campaign.id),
  );
  const callIds = new Set(
    Object.values(state.calls)
      .filter((call) => campaignIds.has(call.campaignId))
      .map((call) => call.id),
  );
  const pick = <T extends { id: string }>(values: Record<string, T>, allowed: Set<string>) =>
    Object.fromEntries(
      Object.values(values)
        .filter((value) => allowed.has(value.id))
        .map((value) => [value.id, value]),
    );
  const demoShopIds = new Set(seedShops.map((shop) => shop.id));
  return {
    sessions: pick(state.sessions, sessionIds),
    specs: Object.fromEntries(
      Object.values(state.specs)
        .filter((spec) => sessionIds.has(spec.sessionId))
        .map((spec) => [spec.id, spec]),
    ),
    shops: pick(state.shops, demoShopIds),
    campaigns: pick(state.campaigns, campaignIds),
    calls: pick(state.calls, callIds),
    quotes: Object.fromEntries(
      Object.values(state.quotes)
        .filter((quote) => callIds.has(quote.callId))
        .map((quote) => [quote.id, quote]),
    ),
    evidence: state.evidence.filter((item) => callIds.has(item.callId)),
    negotiations: Object.fromEntries(
      Object.values(state.negotiations)
        .filter((item) => campaignIds.has(item.campaignId))
        .map((item) => [item.id, item]),
    ),
    audit: state.audit.filter((item) => sessionIds.has(item.sessionId)),
    documents: {},
    shopIdsBySession: Object.fromEntries(
      Object.entries(state.shopIdsBySession).filter(([sessionId]) => sessionIds.has(sessionId)),
    ),
  };
}

export const useWrenchStore = create<State & Actions>()(
  persist(
    (set, get) => ({
      ...empty(),
      hydrated: false,

      ensureSeeded: () => {
        const s = get();
        const missingSeed =
          !s.sessions[DEMO_SESSION_ID] ||
          !s.campaigns[DEMO_CAMPAIGN_ID] ||
          !s.calls["call_precision"] ||
          !s.quotes["q_precision"];
        if (missingSeed) {
          const seed = withSeed();
          set((state) => ({
            sessions: { ...state.sessions, ...seed.sessions },
            specs: { ...state.specs, ...seed.specs },
            shops: { ...state.shops, ...seed.shops },
            campaigns: { ...state.campaigns, ...seed.campaigns },
            calls: { ...state.calls, ...seed.calls },
            quotes: {
              ...Object.fromEntries(
                Object.values(state.quotes)
                  .filter((quote) => !seedCalls.some((call) => call.id === quote.callId))
                  .map((quote) => [quote.id, quote]),
              ),
              ...seed.quotes,
            },
            evidence: [
              ...state.evidence.filter((e) => !seedCalls.some((call) => call.id === e.callId)),
              ...seed.evidence,
            ],
            negotiations: Object.fromEntries(
              Object.values(state.negotiations)
                .filter((negotiation) => negotiation.campaignId !== DEMO_CAMPAIGN_ID)
                .map((negotiation) => [negotiation.id, negotiation]),
            ),
            audit: [...state.audit.filter((a) => a.sessionId !== DEMO_SESSION_ID), ...seed.audit],
            documents: state.documents,
            shopIdsBySession: {
              ...state.shopIdsBySession,
              [DEMO_SESSION_ID]: seedShops.map((shop) => shop.id),
            },
            hydrated: true,
          }));
          void specHash(seedSpec).then((h) => {
            set((state) => ({
              specs: {
                ...state.specs,
                [DEMO_SPEC_ID]: { ...state.specs[DEMO_SPEC_ID], specHash: h },
              },
            }));
          });
        } else if (!s.hydrated) {
          set({ hydrated: true });
        }
      },

      resetDemo: () => {
        const seed = withSeed();
        set((state) => ({
          sessions: { ...state.sessions, ...seed.sessions },
          specs: { ...state.specs, ...seed.specs },
          shops: { ...state.shops, ...seed.shops },
          campaigns: { ...state.campaigns, ...seed.campaigns },
          calls: { ...state.calls, ...seed.calls },
          quotes: {
            ...Object.fromEntries(
              Object.values(state.quotes)
                .filter((quote) => !seedCalls.some((call) => call.id === quote.callId))
                .map((quote) => [quote.id, quote]),
            ),
            ...seed.quotes,
          },
          evidence: [
            ...state.evidence.filter((e) => !seedCalls.some((call) => call.id === e.callId)),
            ...seed.evidence,
          ],
          negotiations: Object.fromEntries(
            Object.values(state.negotiations)
              .filter((negotiation) => negotiation.campaignId !== DEMO_CAMPAIGN_ID)
              .map((negotiation) => [negotiation.id, negotiation]),
          ),
          audit: [...state.audit.filter((a) => a.sessionId !== DEMO_SESSION_ID), ...seed.audit],
          documents: state.documents,
          shopIdsBySession: {
            ...state.shopIdsBySession,
            [DEMO_SESSION_ID]: seedShops.map((shop) => shop.id),
          },
          hydrated: true,
        }));
        void specHash(seedSpec).then((h) => {
          set((state) => ({
            specs: {
              ...state.specs,
              [DEMO_SPEC_ID]: { ...state.specs[DEMO_SPEC_ID], specHash: h },
            },
          }));
        });
      },

      mergeRequestSnapshot: (snapshot) =>
        set((state) => ({
          sessions: { ...state.sessions, [snapshot.session.id]: snapshot.session },
          specs: { ...state.specs, [snapshot.spec.id]: snapshot.spec },
          shops: {
            ...state.shops,
            ...Object.fromEntries(snapshot.shops.map((shop) => [shop.id, shop])),
          },
          documents: { ...state.documents, [snapshot.session.id]: snapshot.documents },
          shopIdsBySession: {
            ...state.shopIdsBySession,
            [snapshot.session.id]: snapshot.shops.map((shop) => shop.id),
          },
        })),

      mergeCampaignSnapshot: (snapshot) =>
        set((state) => ({
          campaigns: { ...state.campaigns, [snapshot.campaign.id]: snapshot.campaign },
          specs: { ...state.specs, [snapshot.spec.id]: snapshot.spec },
          shops: {
            ...state.shops,
            ...Object.fromEntries(snapshot.shops.map((shop) => [shop.id, shop])),
          },
          calls: {
            ...state.calls,
            ...Object.fromEntries(snapshot.calls.map((call) => [call.id, call])),
          },
          quotes: {
            ...state.quotes,
            ...Object.fromEntries(snapshot.quotes.map((quote) => [quote.id, quote])),
          },
          evidence: [
            ...state.evidence.filter(
              (evidence) => !snapshot.calls.some((call) => call.id === evidence.callId),
            ),
            ...snapshot.evidence,
          ],
          negotiations: {
            ...state.negotiations,
            ...Object.fromEntries(
              snapshot.negotiations.map((negotiation) => [negotiation.id, negotiation]),
            ),
          },
        })),

      setSpec: (spec) =>
        set((state) => ({
          specs: { ...state.specs, [spec.id]: spec },
        })),

      addShopsToSession: (sessionId, shops) =>
        set((state) => ({
          shops: { ...state.shops, ...Object.fromEntries(shops.map((shop) => [shop.id, shop])) },
          shopIdsBySession: {
            ...state.shopIdsBySession,
            [sessionId]: Array.from(
              new Set([
                ...(state.shopIdsBySession[sessionId] ?? []),
                ...shops.map((shop) => shop.id),
              ]),
            ),
          },
        })),

      createSession: (mode = "demo") => {
        const sessionId = id("sess");
        const specId = id("spec");
        const now = new Date().toISOString();
        const session: Session = { id: sessionId, mode, status: "draft", createdAt: now };
        const draft: RepairSpec = {
          ...seedSpec,
          id: specId,
          sessionId,
          version: 1,
          status: "draft",
          createdAt: now,
          specHash: undefined,
          confirmedAt: undefined,
        };
        set((state) => ({
          sessions: { ...state.sessions, [sessionId]: session },
          specs: { ...state.specs, [specId]: draft },
          shops: Object.keys(state.shops).length
            ? state.shops
            : Object.fromEntries(seedShops.map((s) => [s.id, s])),
          audit: [
            ...state.audit,
            {
              id: id("ae"),
              sessionId,
              eventType: "session_created",
              message: "Session created (" + mode + " mode)",
              createdAt: now,
            },
          ],
        }));
        return { sessionId, specId };
      },

      addAudit: (sessionId, eventType, message) =>
        set((state) => ({
          audit: [
            ...state.audit,
            {
              id: id("ae"),
              sessionId,
              eventType,
              message,
              createdAt: new Date().toISOString(),
            },
          ],
        })),

      correctMileage: (specId, next) =>
        set((state) => {
          const spec = state.specs[specId];
          if (!spec || spec.status === "confirmed") return {};
          const prev = spec.vehicle.mileage;
          return {
            specs: {
              ...state.specs,
              [specId]: {
                ...spec,
                vehicle: { ...spec.vehicle, mileage: next },
                fieldMeta: {
                  ...spec.fieldMeta,
                  "vehicle.mileage": {
                    source: "manual",
                    status: "verified",
                    confidence: 1,
                    excerpt: "Confirmed by user",
                  },
                },
              },
            },
            audit: [
              ...state.audit,
              {
                id: id("ae"),
                sessionId: spec.sessionId,
                eventType: "field_corrected",
                message: `Mileage updated from ${prev.toLocaleString()} to ${next.toLocaleString()} by user`,
                createdAt: new Date().toISOString(),
              },
            ],
          };
        }),

      updateSpecField: (specId, path, value, source) =>
        set((state) => {
          const spec = state.specs[specId];
          if (!spec || spec.status === "confirmed") return {};
          const next = updatePath(spec, path, value);
          return {
            specs: {
              ...state.specs,
              [specId]: {
                ...next,
                fieldMeta: {
                  ...spec.fieldMeta,
                  [path]: { source, status: "verified", confidence: 0.95 },
                },
              },
            },
          };
        }),

      confirmSpec: async (specId) => {
        const spec = get().specs[specId];
        if (!spec) return;
        const session = get().sessions[spec.sessionId];
        if (session?.mode === "live") {
          const confirmed = await confirmRemoteRepairSpec(spec.sessionId);
          set((state) => ({
            specs: { ...state.specs, [specId]: confirmed },
            sessions: {
              ...state.sessions,
              [spec.sessionId]: { ...state.sessions[spec.sessionId], status: "spec_confirmed" },
            },
          }));
          return;
        }
        const canonical = {
          ...spec,
          specHash: undefined,
          confirmedAt: undefined,
          status: "confirmed" as const,
        };
        const hash = await specHash(canonical);
        set((state) => ({
          specs: {
            ...state.specs,
            [specId]: {
              ...spec,
              status: "confirmed",
              confirmedAt: new Date().toISOString(),
              specHash: hash,
            },
          },
          sessions: {
            ...state.sessions,
            [spec.sessionId]: { ...state.sessions[spec.sessionId], status: "spec_confirmed" },
          },
        }));
      },

      createCampaign: (sessionId, specId, shopIds) => {
        if (get().sessions[sessionId]?.mode === "demo") return DEMO_CAMPAIGN_ID;
        const id = `camp_${crypto.randomUUID()}`;
        const now = new Date().toISOString();
        const campaign: Campaign = {
          id,
          sessionId,
          repairSpecId: specId,
          shopIds,
          status: "running",
          startedAt: now,
          mode: "live",
        };
        // Create queued calls
        const newCalls: Record<string, Call> = {};
        for (const shopId of shopIds) {
          const cid = `call_${crypto.randomUUID()}`;
          newCalls[cid] = {
            id: cid,
            campaignId: id,
            shopId,
            kind: "quote",
            status: "queued",
            phase: "queued",
            currentObjective: "Initiate call",
            durationSeconds: 0,
            transcript: [],
            audioAvailable: false,
            createdAt: now,
          };
        }
        set((state) => ({
          campaigns: { ...state.campaigns, [id]: campaign },
          calls: { ...state.calls, ...newCalls },
          sessions: {
            ...state.sessions,
            [sessionId]: { ...state.sessions[sessionId], status: "campaign_running" },
          },
        }));
        return id;
      },

      advanceCall: (callId, status) =>
        set((state) => {
          const c = state.calls[callId];
          if (!c) return {};
          const nextStatus =
            status ?? CALL_ORDER[Math.min(CALL_ORDER.indexOf(c.status) + 1, CALL_ORDER.length - 1)];
          return {
            calls: {
              ...state.calls,
              [callId]: { ...c, status: nextStatus, durationSeconds: c.durationSeconds + 8 },
            },
          };
        }),

      revealHiddenFee: () =>
        set((state) => {
          const q = state.quotes["q_budget"];
          if (!q) return {};
          return {
            quotes: {
              ...state.quotes,
              q_budget: {
                ...q,
                warnings: Array.from(new Set([...q.warnings, "hidden_fee_disclosed_late"])),
              },
            },
          };
        }),

      simulateNoAnswer: (callId) =>
        set((state) => {
          const c = state.calls[callId];
          if (!c) return {};
          return {
            calls: {
              ...state.calls,
              [callId]: {
                ...c,
                status: "no_answer",
                failureReason: "Shop did not answer after 4 rings",
              },
            },
          };
        }),

      applyNegotiation: (asks) =>
        set((state) => {
          const neg = state.negotiations["neg_1"] ?? seedNegotiation;
          return {
            quotes: { ...state.quotes, q_precision_revised: seedRevisedQuote },
            negotiations: {
              ...state.negotiations,
              neg_1: {
                ...neg,
                approvedByUser: true,
                outcome: "revised",
                revisedQuoteId: "q_precision_revised",
                asks: asks as Negotiation["asks"],
              },
            },
          };
        }),

      deleteSession: (sessionId) =>
        set((state) => {
          const sessions = { ...state.sessions };
          const specs = { ...state.specs };
          const campaigns = { ...state.campaigns };
          const calls = { ...state.calls };
          const quotes = { ...state.quotes };
          const negotiations = { ...state.negotiations };
          const documents = { ...state.documents };
          const shopIdsBySession = { ...state.shopIdsBySession };
          const campaignIds = Object.values(campaigns)
            .filter((campaign) => campaign.sessionId === sessionId)
            .map((campaign) => campaign.id);
          const callIds = Object.values(calls)
            .filter((call) => campaignIds.includes(call.campaignId))
            .map((call) => call.id);
          delete sessions[sessionId];
          delete documents[sessionId];
          delete shopIdsBySession[sessionId];
          Object.values(specs)
            .filter((spec) => spec.sessionId === sessionId)
            .forEach((spec) => delete specs[spec.id]);
          campaignIds.forEach((campaignId) => delete campaigns[campaignId]);
          callIds.forEach((callId) => delete calls[callId]);
          Object.values(quotes)
            .filter((quote) => callIds.includes(quote.callId))
            .forEach((quote) => delete quotes[quote.id]);
          Object.values(negotiations)
            .filter((negotiation) => campaignIds.includes(negotiation.campaignId))
            .forEach((negotiation) => delete negotiations[negotiation.id]);
          return {
            sessions,
            specs,
            campaigns,
            calls,
            quotes,
            negotiations,
            documents,
            shopIdsBySession,
            evidence: state.evidence.filter((item) => !callIds.includes(item.callId)),
            audit: state.audit.filter((item) => item.sessionId !== sessionId),
          };
        }),
    }),
    {
      name: "wrenchbid-store-v3",
      partialize: demoOnlyState,
      onRehydrateStorage: () => () => {
        useWrenchStore.setState({ hydrated: true });
      },
    },
  ),
);

export function useHydrated() {
  return useWrenchStore((s) => s.hydrated);
}
