import { createHash, randomUUID } from "node:crypto";
import type postgres from "postgres";
import { z } from "zod";
import {
  findSupportingShopTurn,
  type QuoteEvidenceCandidate,
  type QuoteEvidenceKind,
} from "../quote-evidence";
import { AUTO_REPAIR_VERTICAL } from "../verticals/auto-repair";
import { completeCampaignIfResolved } from "./campaigns.server";
import { getDatabase } from "./db.server";

const WebhookSchema = z.object({
  type: z.string().min(1),
  event_timestamp: z.union([z.number(), z.string()]),
  data: z.record(z.string(), z.unknown()),
});

type NormalizedTurn = {
  index: number;
  speaker: "agent" | "shop";
  text: string;
  timeSeconds: number;
};

type WebhookOwner = {
  id: string;
  campaign_id: string;
  session_id: string;
  shop_id: string;
  kind: "quote" | "negotiation";
};

const SUPPORTED_EVENT_TYPES = new Set(["post_call_transcription", "call_initiation_failure"]);

function unwrap(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  for (const key of ["value", "result", "data_collection_result"]) {
    if (record[key] !== undefined) return unwrap(record[key]);
  }
  return value;
}

function collection(data: Record<string, unknown>) {
  const analysis = (data.analysis ?? {}) as Record<string, unknown>;
  const raw = (analysis.data_collection_results ?? {}) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, unwrap(value)]));
}

function named(values: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (values[key] != null) return values[key];
  }
  return undefined;
}

function moneyValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value !== "string") return undefined;
  const parsed = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 1000) : undefined;
}

function stringArray(value: unknown) {
  if (Array.isArray(value))
    return value.map(stringValue).filter((item): item is string => Boolean(item));
  const single = stringValue(value);
  return single ? [single] : [];
}

function dateValue(value: unknown) {
  const text = stringValue(value);
  const match = text ? /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(text) : null;
  if (!match) return undefined;
  const normalized = `${match[1]}-${match[2]}-${match[3]}`;
  return Number.isNaN(new Date(`${normalized}T00:00:00.000Z`).getTime()) ? undefined : normalized;
}

function signedCallId(data: Record<string, unknown>) {
  const initiation = (data.conversation_initiation_client_data ?? {}) as Record<string, unknown>;
  const dynamic = (initiation.dynamic_variables ?? {}) as Record<string, unknown>;
  const metadata = (data.metadata ?? {}) as Record<string, unknown>;
  const metadataDynamic = (metadata.dynamic_variables ?? {}) as Record<string, unknown>;
  const candidate = stringValue(
    dynamic.wrenchbid_call_id ??
      metadataDynamic.wrenchbid_call_id ??
      data.wrenchbid_call_id ??
      named(collection(data), "wrenchbid_call_id"),
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

function normalizeTranscript(value: unknown): NormalizedTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((turn, index) => {
      if (!turn || typeof turn !== "object") return null;
      const record = turn as Record<string, unknown>;
      const text = stringValue(record.message ?? record.text);
      if (!text) return null;
      return {
        index,
        speaker: record.role === "agent" ? ("agent" as const) : ("shop" as const),
        text,
        timeSeconds: Number(record.time_in_call_secs ?? record.time_seconds ?? index * 5) || 0,
      };
    })
    .filter((turn): turn is NormalizedTurn => turn !== null);
}

function inferOutcome(
  data: Record<string, unknown>,
  values: Record<string, unknown>,
  turns: NormalizedTurn[],
) {
  const explicit = stringValue(
    named(values, "call_outcome", "outcome", "terminal_outcome"),
  )?.toLowerCase();
  if (explicit?.includes("callback")) return "callback_commitment" as const;
  if (explicit?.includes("declin") || explicit?.includes("refus")) return "declined" as const;
  if (explicit?.includes("no_answer") || explicit?.includes("no answer"))
    return "no_answer" as const;
  if (explicit?.includes("fail")) return "failed" as const;
  if (explicit?.includes("quote")) return "quote" as const;

  const transcript = turns
    .map((turn) => turn.text)
    .join(" ")
    .toLowerCase();
  if (/call (you|the customer) back|callback/.test(transcript))
    return "callback_commitment" as const;
  if (/cannot provide|won't provide|decline/.test(transcript)) return "declined" as const;
  if (moneyValue(named(values, "all_in_total", "total", "quote_total")) != null)
    return "quote" as const;
  const status = stringValue(data.status)?.toLowerCase();
  return status === "failed" ? ("failed" as const) : ("declined" as const);
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
  const parts = moneyValue(named(input.values, "parts", "parts_total"));
  const labor = moneyValue(named(input.values, "labor", "labor_total"));
  const diagnostic = moneyValue(named(input.values, "diagnostic_fee", "diagnostic"));
  const shopSupply = moneyValue(named(input.values, "shop_supply_fee", "shop_supplies"));
  const disposal = moneyValue(named(input.values, "disposal_fee", "disposal"));
  const tax = moneyValue(named(input.values, "tax", "sales_tax"));
  const total = moneyValue(named(input.values, "all_in_total", "total", "quote_total"));
  const warrantyText = stringValue(named(input.values, "warranty", "warranty_text"));
  const warrantyDays = moneyValue(named(input.values, "warranty_days"));
  const earliestDate = dateValue(named(input.values, "earliest_appointment", "earliest_date"));
  const validUntil = dateValue(named(input.values, "quote_expiration", "valid_until"));
  const conditions = stringArray(named(input.values, "conditions", "quote_conditions"));
  const present = [
    parts,
    labor,
    diagnostic,
    shopSupply,
    tax,
    total,
    warrantyText,
    earliestDate,
    validUntil,
    conditions.length ? conditions : undefined,
  ].filter((value) => value !== undefined).length;
  const completeness = present / AUTO_REPAIR_VERTICAL.requiredQuoteFields.length;
  const quoteId = randomUUID();
  const items = [
    ["parts", "Parts", parts],
    ["labor", "Labor", labor],
    ["diagnostic", "Diagnostic fee", diagnostic],
    ["shop_supply", "Shop-supply fee", shopSupply],
    ["disposal", "Disposal fee", disposal],
    ["tax", "Tax", tax],
  ] as const;
  const rawEvidenceCandidates: Array<[string, QuoteEvidenceKind, string | number | undefined]> = [
    ["parts", "money", parts],
    ["labor", "money", labor],
    ["diagnostic_fee", "money", diagnostic],
    ["shop_supply_fee", "money", shopSupply],
    ["disposal_fee", "money", disposal],
    ["tax", "money", tax],
    ["all_in_total", "money", total],
    ["warranty", "text", warrantyText],
    ["warranty_days", "number", warrantyDays],
    ["earliest_appointment", "date", earliestDate],
    ["quote_expiration", "date", validUntil],
  ];
  const evidenceCandidates: QuoteEvidenceCandidate[] = rawEvidenceCandidates.flatMap(
    ([fieldName, kind, value]) => (value == null ? [] : [{ fieldName, kind, value }]),
  );
  for (const condition of conditions) {
    evidenceCandidates.push({ fieldName: "conditions", kind: "text", value: condition });
  }
  const evidenceMatches = evidenceCandidates.flatMap((candidate) => {
    const turn = findSupportingShopTurn(input.turns, candidate);
    return turn ? [{ fieldName: candidate.fieldName, turn }] : [];
  });
  const totalConfirmedInTranscript = evidenceMatches.some(
    (match) => match.fieldName === "all_in_total",
  );
  const warnings = [
    ...(input.revised ? ["revised_after_negotiation"] : []),
    ...(total == null ? ["missing_all_in_total"] : []),
    ...(total != null && !totalConfirmedInTranscript ? ["missing_total_transcript_evidence"] : []),
    ...(completeness < 0.9 ? ["non_comparable_scope"] : []),
  ];

  await transaction`
    INSERT INTO quotes (
      id, call_id, shop_id, status, subtotal, tax, total, currency,
      warranty_text, warranty_days, earliest_date, valid_until, completeness,
      conditions, confirmed_in_call, warnings
    ) VALUES (
      ${quoteId}::uuid,
      ${input.callId}::uuid,
      ${input.shopId}::uuid,
      ${total != null && completeness >= 0.9 ? "complete" : "incomplete"},
      ${parts != null || labor != null ? (parts ?? 0) + (labor ?? 0) + (diagnostic ?? 0) + (shopSupply ?? 0) + (disposal ?? 0) : null},
      ${tax ?? null},
      ${total ?? null},
      'USD',
      ${warrantyText ?? null},
      ${warrantyDays ?? null},
      ${earliestDate ?? null},
      ${validUntil ?? null},
      ${completeness},
      ${transaction.json(conditions)},
      ${total != null && totalConfirmedInTranscript},
      ${transaction.json(warnings)}
    )
  `;
  let sortOrder = 0;
  for (const [category, description, amount] of items) {
    if (amount == null) continue;
    await transaction`
      INSERT INTO quote_items (id, quote_id, category, description, amount, sort_order)
      VALUES (${randomUUID()}::uuid, ${quoteId}::uuid, ${category}, ${description}, ${amount}, ${sortOrder++})
    `;
  }

  for (const { fieldName, turn } of evidenceMatches) {
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
  const values = collection(data);
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
