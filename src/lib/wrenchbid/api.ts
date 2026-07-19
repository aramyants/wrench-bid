import type {
  CampaignSnapshot,
  RequestSnapshot,
  RuntimeCapabilities,
  SessionSummary,
} from "./api-types";
import type { NegotiationAsk, RepairSpec, Shop } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    credentials: "same-origin",
    ...init,
    headers: {
      accept: "application/json",
      ...init?.headers,
    },
  });
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? ((await response.json()) as Record<string, unknown>)
    : { error: await response.text() };
  if (!response.ok) {
    throw new ApiError(
      typeof payload.error === "string" ? payload.error : "The request failed",
      response.status,
      typeof payload.requestId === "string" ? payload.requestId : undefined,
    );
  }
  return payload as T;
}

export async function getCapabilities() {
  const result = await requestJson<{ capabilities: RuntimeCapabilities }>("/api/capabilities");
  return result.capabilities;
}

export async function uploadRepairEstimate(file: File): Promise<RequestSnapshot> {
  const body = new FormData();
  body.set("estimate", file);
  body.set("consent", "true");
  return requestJson<RequestSnapshot>("/api/requests", { method: "POST", body });
}

export function getRequest(id: string) {
  return requestJson<RequestSnapshot>(`/api/requests/${encodeURIComponent(id)}`);
}

export async function listRequests() {
  const result = await requestJson<{ sessions: SessionSummary[] }>("/api/requests");
  return result.sessions;
}

export async function updateRepairSpec(
  sessionId: string,
  path: string,
  value: unknown,
  source: "voice" | "manual",
) {
  const result = await requestJson<{ spec: RepairSpec }>(
    `/api/requests/${encodeURIComponent(sessionId)}/actions`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "update_spec", path, value, source }),
    },
  );
  return result.spec;
}

export async function confirmRemoteRepairSpec(sessionId: string) {
  const result = await requestJson<{ spec: RepairSpec }>(
    `/api/requests/${encodeURIComponent(sessionId)}/actions`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "confirm_spec" }),
    },
  );
  return result.spec;
}

export async function discoverShops(sessionId: string, query: string) {
  const result = await requestJson<{ shops: Shop[] }>(
    `/api/requests/${encodeURIComponent(sessionId)}/discover`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query }),
    },
  );
  return result.shops;
}

export async function addManualShop(
  sessionId: string,
  input: {
    name: string;
    phone: string;
    address: string;
    website?: string;
    phoneVerificationAttested: true;
  },
) {
  const result = await requestJson<{ shop: Shop }>(
    `/api/requests/${encodeURIComponent(sessionId)}/shops`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return result.shop;
}

export async function verifyShopPhone(
  sessionId: string,
  input: { shopId: string; phone: string; phoneVerificationAttested: true },
) {
  const result = await requestJson<{ shop: Shop }>(
    `/api/requests/${encodeURIComponent(sessionId)}/shops`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return result.shop;
}

export async function getVoiceToken(sessionId: string) {
  return requestJson<{ token: string }>(
    `/api/requests/${encodeURIComponent(sessionId)}/voice-token`,
    { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
  );
}

export function createRemoteCampaign(input: {
  sessionId: string;
  shopIds: string[];
  idempotencyKey: string;
  aiDisclosureAccepted: true;
  recordingConsentConfirmed: true;
}) {
  return requestJson<CampaignSnapshot>("/api/campaigns", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function getCampaign(id: string) {
  return requestJson<CampaignSnapshot>(`/api/campaigns/${encodeURIComponent(id)}`);
}

export function startRemoteNegotiation(input: {
  campaignId: string;
  originalQuoteId: string;
  leverageQuoteId: string;
  asks: NegotiationAsk[];
}) {
  return requestJson<{ negotiationId: string; callId: string }>("/api/negotiations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function deleteRemoteRequest(sessionId: string) {
  return requestJson<{ deleted: boolean }>(`/api/requests/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
}
