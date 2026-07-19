import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { E164_PHONE_PATTERN } from "../phone";
import { getServerEnvironment } from "./env.server";

const TokenResponseSchema = z.object({ token: z.string().min(1) });
const OutboundResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  conversation_id: z.string().nullable(),
  callSid: z.string().optional(),
  sip_call_id: z.string().nullable().optional(),
});

async function elevenLabsRequest(path: string, init: RequestInit = {}) {
  const environment = getServerEnvironment();
  if (!environment.ELEVENLABS_API_KEY) {
    throw new Response("ElevenLabs is not configured", { status: 503 });
  }
  const response = await fetch(`https://api.elevenlabs.io${path}`, {
    ...init,
    headers: {
      "xi-api-key": environment.ELEVENLABS_API_KEY,
      ...init.headers,
    },
    signal: init.signal ?? AbortSignal.timeout(20_000),
  });
  return response;
}

export async function createIntakeConversationToken() {
  const environment = getServerEnvironment();
  if (!environment.ELEVENLABS_INTAKE_AGENT_ID) {
    throw new Response("The intake agent is not configured", { status: 503 });
  }
  const search = new URLSearchParams({
    agent_id: environment.ELEVENLABS_INTAKE_AGENT_ID,
    environment: environment.ELEVENLABS_ENVIRONMENT,
  });
  const response = await elevenLabsRequest(`/v1/convai/conversation/token?${search}`);
  if (!response.ok) throw new Response("Unable to create a voice session", { status: 502 });
  return TokenResponseSchema.parse(await response.json()).token;
}

export async function startElevenLabsOutboundCall(input: {
  toNumber: string;
  agentId: string;
  dynamicVariables: Record<string, string | number | boolean>;
  recordingEnabled: boolean;
}) {
  const environment = getServerEnvironment();
  if (!environment.ELEVENLABS_PHONE_NUMBER_ID) {
    throw new Response("The ElevenLabs phone number is not configured", { status: 503 });
  }
  if (!E164_PHONE_PATTERN.test(input.toNumber)) {
    throw new Response("Shop phone number must use E.164 format", { status: 422 });
  }
  const provider = environment.ELEVENLABS_TELEPHONY_PROVIDER;
  const response = await elevenLabsRequest(`/v1/convai/${provider}/outbound-call`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agent_id: input.agentId,
      agent_phone_number_id: environment.ELEVENLABS_PHONE_NUMBER_ID,
      to_number: input.toNumber,
      call_recording_enabled: input.recordingEnabled,
      telephony_call_config: { ringing_timeout_secs: 45 },
      conversation_initiation_client_data: {
        environment: environment.ELEVENLABS_ENVIRONMENT,
        dynamic_variables: input.dynamicVariables,
      },
    }),
  });
  if (!response.ok) {
    throw new Response(`ElevenLabs rejected the outbound call (${response.status})`, {
      status: 502,
    });
  }
  const result = OutboundResponseSchema.parse(await response.json());
  if (!result.success || !result.conversation_id) {
    throw new Response(result.message || "ElevenLabs did not start the call", { status: 502 });
  }
  return {
    conversationId: result.conversation_id,
    providerCallId: result.callSid ?? result.sip_call_id ?? undefined,
  };
}

export async function getElevenLabsConversation(conversationId: string) {
  const response = await elevenLabsRequest(
    `/v1/convai/conversations/${encodeURIComponent(conversationId)}?format=json`,
  );
  if (!response.ok) throw new Response("Unable to retrieve conversation", { status: 502 });
  return response.json() as Promise<unknown>;
}

export async function getElevenLabsConversationAudio(conversationId: string) {
  const response = await elevenLabsRequest(
    `/v1/convai/conversations/${encodeURIComponent(conversationId)}/audio`,
  );
  if (!response.ok) throw new Response("Conversation audio is unavailable", { status: 404 });
  return response;
}

export async function deleteElevenLabsConversation(conversationId: string) {
  const response = await elevenLabsRequest(
    `/v1/convai/conversations/${encodeURIComponent(conversationId)}`,
    { method: "DELETE" },
  );
  if (response.ok || response.status === 404) return;
  throw new Response("Unable to delete an ElevenLabs conversation", { status: 502 });
}

function parseSignature(value: string) {
  const fields = Object.fromEntries(value.split(",").map((part) => part.trim().split("=", 2)));
  return { timestamp: fields.t, signature: fields.v0 };
}

export function verifyElevenLabsWebhook(rawBody: string, signatureHeader: string | null) {
  const secret = getServerEnvironment().ELEVENLABS_WEBHOOK_SECRET;
  if (!secret) throw new Response("Webhook verification is not configured", { status: 503 });
  if (!signatureHeader) throw new Response("Missing webhook signature", { status: 401 });
  const { timestamp, signature } = parseSignature(signatureHeader);
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) {
    throw new Response("Malformed webhook signature", { status: 401 });
  }
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
    throw new Response("Expired webhook signature", { status: 401 });
  }
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new Response("Invalid webhook signature", { status: 401 });
  }
}
