import { createHash, randomUUID } from "node:crypto";
import type postgres from "postgres";
import { z } from "zod";
import {
  extractDataCollection,
  inferOutcome,
  namedValue,
  normalizeQuote,
  normalizeTranscript,
  stringValue,
  type NormalizedTurn,
} from "../call-normalization";
import { completeCampaignIfResolved } from "./campaigns.server";
import { getDatabase } from "./db.server";
import { deferElevenLabsInitiationFailure } from "./provider-failures.server";

export const MAX_ELEVENLABS_WEBHOOK_BODY_BYTES = 2 * 1024 * 1024;

function payloadTooLargeResponse() {
  return new Response("Webhook payload is too large", { status: 413 });
}

export async function readElevenLabsWebhookBody(
  request: Request,
  maximumBytes = MAX_ELEVENLABS_WEBHOOK_BODY_BYTES,
) {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const normalizedLength = contentLength.trim();
    if (!/^\d+$/.test(normalizedLength)) {
      throw new Response("Malformed Content-Length header", { status: 400 });
    }
    const declaredBytes = Number(normalizedLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maximumBytes) {
      throw payloadTooLargeResponse();
    }
  }

  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maximumBytes) {
        await reader.cancel();
        throw payloadTooLargeResponse();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, receivedBytes));
  } catch (error) {
    if (error instanceof Response) throw error;
    throw new Response("Webhook payload must be valid UTF-8", { status: 400 });
  }
}

const WebhookSchema = z.object({
  type: z.string().min(1),
  event_timestamp: z.union([z.number(), z.string()]),
  data: z.record(z.string(), z.unknown()),
});

type WebhookOwner = {
  id: string;
  campaign_id: string;
  session_id: string;
  shop_id: string;
  kind: "quote" | "negotiation";
};

const SUPPORTED_EVENT_TYPES = new Set(["post_call_transcription", "call_initiation_failure"]);

function signedCallId(data: Record<string, unknown>) {
  const initiation = (data.conversation_initiation_client_data ?? {}) as Record<string, unknown>;
  const dynamic = (initiation.dynamic_variables ?? {}) as Record<string, unknown>;
  const metadata = (data.metadata ?? {}) as Record<string, unknown>;
  const metadataDynamic = (metadata.dynamic_variables ?? {}) as Record<string, unknown>;
  const candidate = stringValue(
    dynamic.wrenchbid_call_id ??
      metadataDynamic.wrenchbid_call_id ??
      data.wrenchbid_call_id ??
      namedValue(extractDataCollection(data), "wrenchbid_call_id"),
  );
  return candidate &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : undefined;
}

async function resolveWebhookOwner(
  data: Record<string, unknown>,
): Promise<WebhookOwner | undefined> {
  const conversationId = stringValue(data.conversation_id);
  const callId = signedCallId(data);
  if (!conversationId && !callId) return undefined;
  const sql = getDatabase();
  const [owner] = await sql<Array<WebhookOwner>>`
    SELECT call.id, call.campaign_id, campaign.session_id, call.shop_id, call.kind
    FROM calls call
    JOIN campaigns campaign ON campaign.id = call.campaign_id
    WHERE (${conversationId ?? null}::text IS NOT NULL
        AND call.provider_conversation_id = ${conversationId ?? null})
       OR (${callId ?? null}::uuid IS NOT NULL AND call.id = ${callId ?? null}::uuid)
    ORDER BY (call.provider_conversation_id = ${conversationId ?? null}) DESC NULLS LAST
    LIMIT 1
  `;
  return owner;
}

async function persistQuote(
  transaction: postgres.TransactionSql,
  input: {
    callId: string;
    shopId: string;
    values: Record<string, unknown>;
    turns: NormalizedTurn[];
    revised: boolean;
  },
) {
  const [existing] = await transaction<Array<{ id: string }>>`
    SELECT id FROM quotes WHERE call_id = ${input.callId}::uuid LIMIT 1
  `;
  if (existing) return existing.id;
  const quote = normalizeQuote({
    values: input.values,
    turns: input.turns,
    revised: input.revised,
  });
  const quoteId = randomUUID();

  await transaction`
    INSERT INTO quotes (
      id, call_id, shop_id, status, subtotal, tax, total, currency,
      warranty_text, warranty_days, earliest_date, valid_until, completeness,
      conditions, confirmed_in_call, warnings
    ) VALUES (
      ${quoteId}::uuid,
      ${input.callId}::uuid,
      ${input.shopId}::uuid,
      ${quote.status},
      ${quote.subtotal},
      ${quote.tax ?? null},
      ${quote.total ?? null},
      ${quote.currency ?? "USD"},
      ${quote.warrantyText ?? null},
      ${quote.warrantyDays ?? null},
      ${quote.earliestDate ?? null},
      ${quote.validUntil ?? null},
      ${quote.completeness},
      ${transaction.json(quote.conditions)},
      ${quote.confirmedInCall},
      ${transaction.json(quote.warnings)}
    )
  `;
  let sortOrder = 0;
  for (const { category, description, amount } of quote.items) {
    await transaction`
      INSERT INTO quote_items (id, quote_id, category, description, amount, sort_order)
      VALUES (${randomUUID()}::uuid, ${quoteId}::uuid, ${category}, ${description}, ${amount}, ${sortOrder++})
    `;
  }

  for (const { fieldName, turn } of quote.evidence) {
    await transaction`
      INSERT INTO evidence_spans (
        id, call_id, quote_id, field_name, turn_index, speaker, transcript_text, time_seconds
      ) VALUES (
        ${randomUUID()}::uuid,
        ${input.callId}::uuid,
        ${quoteId}::uuid,
        ${fieldName},
        ${turn.index},
        ${turn.speaker},
        ${turn.text},
        ${turn.timeSeconds}
      )
    `;
  }
  return quoteId;
}

async function processTranscription(data: Record<string, unknown>, call: WebhookOwner) {
  const conversationId = stringValue(data.conversation_id);
  if (!conversationId) return "ignored" as const;
  const sql = getDatabase();
  const turns = normalizeTranscript(data.transcript);
  const values = extractDataCollection(data);
  const outcome = inferOutcome(data, values, turns);
  const duration = Math.round(
    Number(
      ((data.metadata ?? {}) as Record<string, unknown>).call_duration_secs ??
        turns.at(-1)?.timeSeconds ??
        0,
    ),
  );
  const transitioned = await sql.begin(async (transaction) => {
    const [claimed] = await transaction<Array<{ id: string }>>`
      UPDATE calls
      SET
        status = ${outcome === "callback_commitment" ? "waiting_callback" : outcome === "quote" ? "completed" : outcome},
        outcome = ${outcome},
        duration_seconds = ${Math.max(0, duration)},
        transcript = ${transaction.json(turns)},
        provider_conversation_id = COALESCE(provider_conversation_id, ${conversationId}),
        recording_url = ${data.has_audio === true ? `/api/calls/${call.id}/audio` : null},
        dispatch_completed_at = COALESCE(dispatch_completed_at, now()),
        completed_at = now(),
        updated_at = now()
      WHERE id = ${call.id}::uuid
        AND status NOT IN ('completed', 'declined', 'no_answer', 'failed', 'waiting_callback')
      RETURNING id
    `;
    if (!claimed) return false;

    if (outcome === "quote") {
      const quoteId = await persistQuote(transaction, {
        callId: call.id,
        shopId: call.shop_id,
        values,
        turns,
        revised: call.kind === "negotiation",
      });
      if (call.kind === "negotiation") {
        await transaction`
          UPDATE negotiations
          SET
            revised_quote_id = ${quoteId}::uuid,
            outcome = 'revised',
            provider_conversation_id = COALESCE(provider_conversation_id, ${conversationId})
          WHERE call_id = ${call.id}::uuid
        `;
      }
    } else if (call.kind === "negotiation") {
      await transaction`
        UPDATE negotiations
        SET
          outcome = ${outcome === "declined" ? "rejected" : "failed"},
          provider_conversation_id = COALESCE(provider_conversation_id, ${conversationId})
        WHERE call_id = ${call.id}::uuid
      `;
    }
    return true;
  });
  await completeCampaignIfResolved(call.campaign_id);
  return transitioned ? ("processed" as const) : ("ignored" as const);
}

async function processInitiationFailure(data: Record<string, unknown>, call: WebhookOwner) {
  const conversationId = stringValue(data.conversation_id);
  if (!conversationId) return "ignored" as const;
  const reason = stringValue(data.failure_reason) ?? "unknown";
  const noAnswer = reason === "no-answer" || reason === "busy";
  const sql = getDatabase();
  const transitioned = await sql.begin(async (transaction) => {
    const [claimed] = await transaction<Array<{ id: string }>>`
      UPDATE calls
      SET
        status = ${noAnswer ? "no_answer" : "failed"},
        outcome = ${noAnswer ? "no_answer" : "failed"},
        failure_reason = ${reason},
        provider_conversation_id = COALESCE(provider_conversation_id, ${conversationId}),
        dispatch_completed_at = COALESCE(dispatch_completed_at, now()),
        completed_at = now(),
        updated_at = now()
      WHERE id = ${call.id}::uuid
        AND status NOT IN ('completed', 'declined', 'no_answer', 'failed', 'waiting_callback')
      RETURNING id
    `;
    if (!claimed) return false;
    if (call.kind === "negotiation") {
      await transaction`
        UPDATE negotiations
        SET
          outcome = 'failed',
          provider_conversation_id = COALESCE(provider_conversation_id, ${conversationId})
        WHERE call_id = ${call.id}::uuid
      `;
    }
    return true;
  });
  await completeCampaignIfResolved(call.campaign_id);
  return transitioned ? ("processed" as const) : ("ignored" as const);
}

export async function ingestElevenLabsWebhook(rawBody: string) {
  const rawPayload = JSON.parse(rawBody);
  const payload = WebhookSchema.parse(rawPayload);
  const owner = await resolveWebhookOwner(payload.data);
  if (!owner) {
    if (payload.type === "call_initiation_failure") {
      const conversationId = stringValue(payload.data.conversation_id);
      if (!conversationId) {
        throw new Response("Call-initiation failure is missing a conversation ID", {
          status: 422,
        });
      }
      await deferElevenLabsInitiationFailure(
        conversationId,
        stringValue(payload.data.failure_reason) ?? "unknown",
      );
      return { duplicate: false, status: "deferred" as const };
    }
    if (!SUPPORTED_EVENT_TYPES.has(payload.type)) {
      return { duplicate: false, status: "ignored" as const };
    }
    throw new Response("The signed webhook could not yet be mapped to a WrenchBid call", {
      status: 503,
      headers: { "Retry-After": "30" },
    });
  }
  const conversationId = stringValue(payload.data.conversation_id) ?? "unknown";
  const providerEventId = createHash("sha256")
    .update(`${payload.type}:${conversationId}:${payload.event_timestamp}`)
    .digest("hex");
  const eventId = randomUUID();
  const sql = getDatabase();
  const [claimed] = await sql<Array<{ id: string }>>`
    INSERT INTO webhook_events (
      id, provider, provider_event_id, event_type, payload, status,
      call_id, session_id, processing_started_at, attempt_count
    ) VALUES (
      ${eventId}::uuid,
      'elevenlabs',
      ${providerEventId},
      ${payload.type},
      ${sql.json(rawPayload)},
      'received',
      ${owner.id}::uuid,
      ${owner.session_id}::uuid,
      now(),
      1
    )
    ON CONFLICT (provider, provider_event_id) DO UPDATE
    SET
      status = 'received',
      error = NULL,
      processed_at = NULL,
      processing_started_at = now(),
      attempt_count = webhook_events.attempt_count + 1,
      call_id = COALESCE(webhook_events.call_id, EXCLUDED.call_id),
      session_id = COALESCE(webhook_events.session_id, EXCLUDED.session_id)
    WHERE webhook_events.status = 'failed'
       OR (
         webhook_events.status = 'received'
         AND webhook_events.processing_started_at < now() - interval '5 minutes'
       )
    RETURNING id
  `;
  if (!claimed) {
    const [existing] = await sql<Array<{ status: string }>>`
      SELECT status
      FROM webhook_events
      WHERE provider = 'elevenlabs' AND provider_event_id = ${providerEventId}
      LIMIT 1
    `;
    if (existing?.status === "processed" || existing?.status === "ignored") {
      return { duplicate: true };
    }
    throw new Response("This webhook event is already being processed", {
      status: 503,
      headers: { "Retry-After": "30" },
    });
  }

  try {
    const status =
      payload.type === "post_call_transcription"
        ? await processTranscription(payload.data, owner)
        : payload.type === "call_initiation_failure"
          ? await processInitiationFailure(payload.data, owner)
          : ("ignored" as const);
    await sql`
      UPDATE webhook_events
      SET status = ${status}, processed_at = now()
      WHERE id = ${claimed.id}::uuid
    `;
    return { duplicate: false, status };
  } catch (error) {
    await sql`
      UPDATE webhook_events
      SET status = 'failed', error = ${String(error).slice(0, 1000)}, processed_at = now()
      WHERE id = ${claimed.id}::uuid
    `;
    throw error;
  }
}
