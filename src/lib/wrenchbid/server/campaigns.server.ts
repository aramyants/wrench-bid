import { randomUUID } from "node:crypto";
import type {
  Call,
  Campaign,
  EvidenceSpan,
  Negotiation,
  Quote,
  QuoteItem,
  RepairSpec,
  Shop,
} from "../types";
import {
  CallSchema,
  CampaignSchema,
  EvidenceSpanSchema,
  NegotiationSchema,
  QuoteItemSchema,
  QuoteSchema,
  RepairSpecSchema,
  ShopSchema,
} from "../types";
import { isVerifiedCallDestination } from "../phone";
import { AUTO_REPAIR_VERTICAL } from "../verticals/auto-repair";
import { getDatabase } from "./db.server";
import { startElevenLabsOutboundCall } from "./elevenlabs.server";
import { getServerEnvironment } from "./env.server";
import { getRequestSnapshot } from "./requests.server";

export type CampaignSnapshot = {
  campaign: Campaign;
  spec: RepairSpec;
  shops: Shop[];
  calls: Call[];
  quotes: Quote[];
  evidence: EvidenceSpan[];
  negotiations: Negotiation[];
};

function iso(value: Date | string | null | undefined) {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function numberOrUndefined(value: unknown) {
  if (value == null) return undefined;
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
}

function parseSuppressedPhoneNumbers(value: string) {
  return value
    .split(",")
    .map((phone) => phone.trim())
    .filter(Boolean);
}

const OUTBOUND_SAFETY_FAILURE =
  "Dispatch blocked by the verified-phone, disclosure, recording-consent, or suppression policy";

export async function createCampaign(input: {
  projectId: string;
  sessionId: string;
  shopIds: string[];
  idempotencyKey: string;
  aiDisclosureAccepted: boolean;
  recordingConsentConfirmed: boolean;
}) {
  const environment = getServerEnvironment();
  if (!environment.OUTBOUND_CALLS_ENABLED) {
    throw new Response("Outbound calls are disabled by the operator", { status: 503 });
  }
  if (
    !environment.ELEVENLABS_API_KEY ||
    !environment.ELEVENLABS_CALLER_AGENT_ID ||
    !environment.ELEVENLABS_PHONE_NUMBER_ID ||
    !environment.ELEVENLABS_WEBHOOK_SECRET
  ) {
    throw new Response("Outbound calling and verified result ingestion are not fully configured", {
      status: 503,
    });
  }
  const uniqueShopIds = [...new Set(input.shopIds)];
  if (uniqueShopIds.length < AUTO_REPAIR_VERTICAL.minimumVendors) {
    throw new Response(`Select at least ${AUTO_REPAIR_VERTICAL.minimumVendors} shops`, {
      status: 422,
    });
  }
  if (!input.aiDisclosureAccepted || !input.recordingConsentConfirmed) {
    throw new Response("AI disclosure and recording-consent checks must be confirmed", {
      status: 422,
    });
  }

  const snapshot = await getRequestSnapshot(input.projectId, input.sessionId);
  if (!snapshot) throw new Response("Request not found", { status: 404 });
  if (snapshot.spec.status !== "confirmed" || !snapshot.spec.specHash) {
    throw new Response("Confirm and seal the RepairSpec before starting calls", { status: 409 });
  }

  const sql = getDatabase();
  const shops = await sql<
    Array<{
      id: string;
      name: string;
      phone: string | null;
      phone_verified: boolean;
      address: string | null;
      website: string | null;
      hours: string | null;
      discovery_source: string;
    }>
  >`
    SELECT
      shop.id,
      shop.name,
      shop.phone,
      shop.phone_verified,
      shop.address,
      shop.website,
      shop.hours,
      shop.discovery_source
    FROM shops shop
    JOIN session_shops selection ON selection.shop_id = shop.id
    JOIN repair_sessions session ON session.id = selection.session_id
    WHERE session.id = ${input.sessionId}::uuid
      AND session.project_id = ${input.projectId}::uuid
      AND shop.id = ANY(${uniqueShopIds}::uuid[])
  `;
  if (shops.length !== uniqueShopIds.length) {
    throw new Response("One or more shops do not belong to this request", { status: 403 });
  }
  const invalidPhones = shops.filter(
    (shop) => !isVerifiedCallDestination(shop.phone, shop.phone_verified),
  );
  if (invalidPhones.length > 0) {
    throw new Response(
      `Verify an E.164 phone number for: ${invalidPhones.map((shop) => shop.name).join(", ")}`,
      { status: 422 },
    );
  }
  const destinations = shops.map((shop) => shop.phone as string);
  if (new Set(destinations).size !== destinations.length) {
    throw new Response(
      "Select distinct shop phone numbers; duplicate destinations are not called",
      {
        status: 422,
      },
    );
  }
  const suppressed = new Set(parseSuppressedPhoneNumbers(environment.SUPPRESSED_PHONE_NUMBERS));
  if (destinations.some((phone) => suppressed.has(phone))) {
    throw new Response("A selected destination is on the operator suppression list", {
      status: 422,
    });
  }

  const [existing] = await sql<Array<{ id: string }>>`
    SELECT campaign.id
    FROM campaigns campaign
    JOIN repair_sessions session ON session.id = campaign.session_id
    WHERE campaign.idempotency_key = ${input.idempotencyKey}
      AND session.project_id = ${input.projectId}::uuid
    LIMIT 1
  `;
  if (existing) return existing.id;

  const campaignId = randomUUID();
  const now = new Date().toISOString();
  const sealedSpecHash = snapshot.spec.specHash;
  return sql.begin(async (transaction) => {
    const [lockedProject] = await transaction<Array<{ id: string }>>`
      SELECT id
      FROM projects
      WHERE id = ${input.projectId}::uuid
      FOR UPDATE
    `;
    if (!lockedProject) throw new Response("Project not found", { status: 404 });

    const [lockedExisting] = await transaction<Array<{ id: string }>>`
      SELECT campaign.id
      FROM campaigns campaign
      JOIN repair_sessions session ON session.id = campaign.session_id
      WHERE campaign.idempotency_key = ${input.idempotencyKey}
        AND session.project_id = ${input.projectId}::uuid
      LIMIT 1
    `;
    if (lockedExisting) return lockedExisting.id;

    const [usage] = await transaction<Array<{ campaigns: number }>>`
      SELECT count(*)::int AS campaigns
      FROM campaigns campaign
      JOIN repair_sessions session ON session.id = campaign.session_id
      WHERE session.project_id = ${input.projectId}::uuid
        AND campaign.created_at >= now() - interval '24 hours'
    `;
    if ((usage?.campaigns ?? 0) >= environment.MAX_CAMPAIGNS_PER_PROJECT_PER_DAY) {
      throw new Response("The daily outbound campaign limit has been reached", {
        status: 429,
        headers: { "retry-after": "3600" },
      });
    }

    await transaction`
      INSERT INTO campaigns (
        id, session_id, repair_spec_id, spec_hash, spec_snapshot, status, mode,
        idempotency_key, ai_disclosure_accepted, recording_consent_confirmed,
        started_at, created_at
      ) VALUES (
        ${campaignId}::uuid,
        ${input.sessionId}::uuid,
        ${snapshot.spec.id}::uuid,
        ${sealedSpecHash},
        ${transaction.json(snapshot.spec)},
        'running',
        'live',
        ${input.idempotencyKey},
        ${input.aiDisclosureAccepted},
        ${input.recordingConsentConfirmed},
        ${now},
        ${now}
      )
    `;
    for (const [index, shop] of shops.entries()) {
      const style =
        AUTO_REPAIR_VERTICAL.counterpartyProfiles[
          index % AUTO_REPAIR_VERTICAL.counterpartyProfiles.length
        ];
      await transaction`
        INSERT INTO calls (
          id, campaign_id, shop_id, style_profile, status, current_objective, created_at, updated_at
        ) VALUES (
          ${randomUUID()}::uuid,
          ${campaignId}::uuid,
          ${shop.id}::uuid,
          ${style.id},
          'queued',
          'Introduce the immutable RepairSpec and request an itemized all-in quote',
          ${now},
          ${now}
        )
      `;
      await transaction`
        UPDATE session_shops
        SET selected = true
        WHERE session_id = ${input.sessionId}::uuid AND shop_id = ${shop.id}::uuid
      `;
    }
    await transaction`
      UPDATE repair_sessions
      SET status = 'campaign_running', updated_at = now()
      WHERE id = ${input.sessionId}::uuid AND project_id = ${input.projectId}::uuid
    `;
    await transaction`
      INSERT INTO audit_events (id, project_id, session_id, event_type, message, metadata)
      VALUES (
        ${randomUUID()}::uuid,
        ${input.projectId}::uuid,
        ${input.sessionId}::uuid,
        'campaign_created',
        ${`Campaign created for ${shops.length} shops using sealed RepairSpec ${snapshot.spec.specHash}`},
        ${transaction.json({ campaignId, shopIds: uniqueShopIds, specHash: snapshot.spec.specHash })}
      )
    `;
    return campaignId;
  });
}

async function claimCallForDispatch(callId: string, suppressedPhones: string[]) {
  const sql = getDatabase();
  const [claimed] = await sql<
    Array<{
      id: string;
      phone: string;
      shop_name: string;
      style_profile: string;
      spec_snapshot: RepairSpec;
      recording_consent_confirmed: boolean;
    }>
  >`
    UPDATE calls call
    SET dispatch_started_at = now(), updated_at = now()
    FROM campaigns campaign, shops shop
    WHERE call.id = ${callId}::uuid
      AND call.campaign_id = campaign.id
      AND call.shop_id = shop.id
      AND call.kind = 'quote'
      AND call.status = 'queued'
      AND call.dispatch_started_at IS NULL
      AND campaign.ai_disclosure_accepted IS TRUE
      AND campaign.recording_consent_confirmed IS TRUE
      AND shop.phone_verified IS TRUE
      AND shop.phone ~ '^[+][1-9][0-9]{7,14}$'
      AND NOT (shop.phone = ANY(${suppressedPhones}::text[]))
    RETURNING
      call.id,
      shop.phone,
      shop.name AS shop_name,
      call.style_profile,
      campaign.spec_snapshot,
      campaign.recording_consent_confirmed
  `;
  return claimed;
}

async function failUnclaimedQuoteCall(callId: string) {
  const sql = getDatabase();
  await sql`
    UPDATE calls
    SET
      status = 'failed',
      outcome = 'failed',
      failure_reason = ${OUTBOUND_SAFETY_FAILURE},
      dispatch_completed_at = now(),
      completed_at = now(),
      updated_at = now()
    WHERE id = ${callId}::uuid
      AND kind = 'quote'
      AND status = 'queued'
      AND dispatch_started_at IS NULL
  `;
}

export async function dispatchCampaign(projectId: string, campaignId: string) {
  const environment = getServerEnvironment();
  if (
    !environment.OUTBOUND_CALLS_ENABLED ||
    !environment.ELEVENLABS_API_KEY ||
    !environment.ELEVENLABS_CALLER_AGENT_ID ||
    !environment.ELEVENLABS_PHONE_NUMBER_ID ||
    !environment.ELEVENLABS_WEBHOOK_SECRET
  ) {
    throw new Response("Outbound calling and verified result ingestion are not fully configured", {
      status: 503,
    });
  }
  const sql = getDatabase();
  const calls = await sql<Array<{ id: string }>>`
    SELECT call.id
    FROM calls call
    JOIN campaigns campaign ON campaign.id = call.campaign_id
    JOIN repair_sessions session ON session.id = campaign.session_id
    WHERE campaign.id = ${campaignId}::uuid
      AND session.project_id = ${projectId}::uuid
      AND call.kind = 'quote'
      AND call.status = 'queued'
      AND call.dispatch_started_at IS NULL
    ORDER BY call.created_at
  `;
  if (calls.length === 0) return;
  const suppressedPhones = parseSuppressedPhoneNumbers(environment.SUPPRESSED_PHONE_NUMBERS);

  await Promise.allSettled(
    calls.map(async ({ id }) => {
      const call = await claimCallForDispatch(id, suppressedPhones);
      if (!call) {
        await failUnclaimedQuoteCall(id);
        return;
      }
      try {
        const result = await startElevenLabsOutboundCall({
          toNumber: call.phone,
          agentId: environment.ELEVENLABS_CALLER_AGENT_ID as string,
          recordingEnabled: call.recording_consent_confirmed,
          dynamicVariables: {
            wrenchbid_call_id: call.id,
            shop_name: call.shop_name,
            repair_spec_json: JSON.stringify(call.spec_snapshot),
            required_quote_fields: AUTO_REPAIR_VERTICAL.requiredQuoteFields.join(", "),
            counterparty_style:
              "Unknown shop behavior. Adapt naturally and never assume pricing, fees, or willingness to negotiate.",
            identity_policy: AUTO_REPAIR_VERTICAL.agentPolicy.identity,
            disclosure_policy: AUTO_REPAIR_VERTICAL.agentPolicy.disclosure,
            scope_policy: AUTO_REPAIR_VERTICAL.agentPolicy.scope,
            terminal_outcome_policy: AUTO_REPAIR_VERTICAL.agentPolicy.terminalOutcomes,
          },
        });
        await sql`
          UPDATE calls
          SET
            status = CASE WHEN status = 'queued' THEN 'ringing' ELSE status END,
            provider_conversation_id = COALESCE(
              provider_conversation_id,
              ${result.conversationId}
            ),
            provider_call_id = COALESCE(provider_call_id, ${result.providerCallId ?? null}),
            dispatch_completed_at = COALESCE(dispatch_completed_at, now()),
            updated_at = now()
          WHERE id = ${call.id}::uuid
        `;
      } catch (error) {
        const reason =
          error instanceof Response
            ? await error.text()
            : "Ambiguous provider dispatch failure; not retried";
        await sql`
          UPDATE calls
          SET
            status = 'failed',
            outcome = 'failed',
            failure_reason = ${reason.slice(0, 500)},
            dispatch_completed_at = now(),
            completed_at = now(),
            updated_at = now()
          WHERE id = ${call.id}::uuid
            AND status = 'queued'
        `;
      }
    }),
  );
  await completeCampaignIfResolved(campaignId);
}

export async function completeCampaignIfResolved(campaignId: string) {
  const sql = getDatabase();
  const [progress] = await sql<
    Array<{ remaining: number; session_id: string; project_id: string }>
  >`
    SELECT
      count(*) FILTER (WHERE call.status NOT IN ('completed', 'declined', 'no_answer', 'failed', 'waiting_callback'))::int AS remaining,
      campaign.session_id,
      session.project_id
    FROM campaigns campaign
    JOIN repair_sessions session ON session.id = campaign.session_id
    JOIN calls call ON call.campaign_id = campaign.id AND call.kind = 'quote'
    WHERE campaign.id = ${campaignId}::uuid
    GROUP BY campaign.session_id, session.project_id
  `;
  if (progress?.remaining !== 0) return;
  await sql.begin(async (transaction) => {
    const completed = await transaction`
      UPDATE campaigns SET status = 'completed', completed_at = COALESCE(completed_at, now())
      WHERE id = ${campaignId}::uuid AND status = 'running'
      RETURNING id
    `;
    if (completed.length === 0) return;
    await transaction`
      UPDATE repair_sessions SET status = 'completed', updated_at = now()
      WHERE id = ${progress.session_id}::uuid
    `;
    await transaction`
      INSERT INTO audit_events (id, project_id, session_id, event_type, message, metadata)
      VALUES (
        ${randomUUID()}::uuid,
        ${progress.project_id}::uuid,
        ${progress.session_id}::uuid,
        'campaign_completed',
        'Every quote call reached a structured terminal outcome',
        ${transaction.json({ campaignId })}
      )
    `;
  });
}

async function recoverStaleDispatches(projectId: string, campaignId: string) {
  const sql = getDatabase();
  const recovered = await sql`
    UPDATE calls call
    SET
      status = 'failed',
      outcome = 'failed',
      failure_reason = 'Dispatch claim expired without a provider conversation ID; not retried to avoid a duplicate call',
      dispatch_completed_at = now(),
      completed_at = now(),
      updated_at = now()
    FROM campaigns campaign, repair_sessions session
    WHERE call.campaign_id = campaign.id
      AND campaign.session_id = session.id
      AND campaign.id = ${campaignId}::uuid
      AND session.project_id = ${projectId}::uuid
      AND call.status = 'queued'
      AND call.dispatch_started_at < now() - interval '15 minutes'
      AND call.provider_conversation_id IS NULL
    RETURNING call.id
  `;
  if (recovered.length > 0) await completeCampaignIfResolved(campaignId);
}

export async function getCampaignSnapshot(
  projectId: string,
  campaignId: string,
): Promise<CampaignSnapshot | null> {
  await recoverStaleDispatches(projectId, campaignId);
  const sql = getDatabase();
  const [campaignRow] = await sql<
    Array<{
      id: string;
      session_id: string;
      repair_spec_id: string;
      spec_snapshot: unknown;
      status: Campaign["status"];
      mode: Campaign["mode"];
      started_at: Date | null;
      completed_at: Date | null;
      created_at: Date;
    }>
  >`
    SELECT campaign.*
    FROM campaigns campaign
    JOIN repair_sessions session ON session.id = campaign.session_id
    WHERE campaign.id = ${campaignId}::uuid
      AND session.project_id = ${projectId}::uuid
      AND session.deleted_at IS NULL
    LIMIT 1
  `;
  if (!campaignRow) return null;

  const callRows = await sql<Array<Record<string, unknown>>>`
    SELECT call.*
    FROM calls call
    WHERE call.campaign_id = ${campaignId}::uuid
    ORDER BY call.created_at
  `;
  const shopRows = await sql<Array<Record<string, unknown>>>`
    SELECT DISTINCT shop.*
    FROM shops shop
    JOIN calls call ON call.shop_id = shop.id
    WHERE call.campaign_id = ${campaignId}::uuid
    ORDER BY shop.name
  `;
  const quoteRows = await sql<Array<Record<string, unknown>>>`
    SELECT quote.*
    FROM quotes quote
    JOIN calls call ON call.id = quote.call_id
    WHERE call.campaign_id = ${campaignId}::uuid
    ORDER BY quote.created_at
  `;
  const quoteIds = quoteRows.map((row) => row.id as string);
  const itemRows = quoteIds.length
    ? await sql<Array<Record<string, unknown>>>`
        SELECT * FROM quote_items WHERE quote_id = ANY(${quoteIds}::uuid[]) ORDER BY sort_order, id
      `
    : [];
  const evidenceRows = await sql<Array<Record<string, unknown>>>`
    SELECT evidence.*
    FROM evidence_spans evidence
    JOIN calls call ON call.id = evidence.call_id
    WHERE call.campaign_id = ${campaignId}::uuid
    ORDER BY evidence.call_id, evidence.turn_index
  `;
  const negotiationRows = await sql<Array<Record<string, unknown>>>`
    SELECT * FROM negotiations WHERE campaign_id = ${campaignId}::uuid ORDER BY created_at
  `;

  const calls = callRows.map((row) =>
    CallSchema.parse({
      id: row.id,
      campaignId: row.campaign_id,
      shopId: row.shop_id,
      kind: row.kind,
      status: row.status,
      phase: row.status,
      currentObjective: row.current_objective ?? undefined,
      durationSeconds: row.duration_seconds,
      transcript: row.transcript,
      audioAvailable: Boolean(row.recording_url),
      audioUrl: row.recording_url ?? undefined,
      providerConversationId: row.provider_conversation_id ?? undefined,
      providerCallId: row.provider_call_id ?? undefined,
      outcome: row.outcome ?? undefined,
      failureReason: row.failure_reason ?? undefined,
      createdAt: iso(row.created_at as string | Date),
    }),
  );
  const itemsByQuote = new Map<string, QuoteItem[]>();
  for (const row of itemRows) {
    const item = QuoteItemSchema.parse({
      id: row.id,
      category: row.category,
      description: row.description,
      amount: numberOrUndefined(row.amount) ?? 0,
      included: row.included,
      partsGrade: row.parts_grade ?? undefined,
      disclosureNote: row.disclosure_note ?? undefined,
    });
    const quoteId = row.quote_id as string;
    itemsByQuote.set(quoteId, [...(itemsByQuote.get(quoteId) ?? []), item]);
  }
  const quotes = quoteRows.map((row) =>
    QuoteSchema.parse({
      id: row.id,
      callId: row.call_id,
      shopId: row.shop_id,
      status: row.status,
      items: itemsByQuote.get(row.id as string) ?? [],
      subtotal: numberOrUndefined(row.subtotal),
      tax: numberOrUndefined(row.tax),
      total: numberOrUndefined(row.total),
      totalRange: row.total_range ?? undefined,
      currency: row.currency,
      warrantyText: row.warranty_text ?? undefined,
      warrantyDays: numberOrUndefined(row.warranty_days),
      earliestDate: row.earliest_date ? String(row.earliest_date) : undefined,
      validUntil: row.valid_until ? String(row.valid_until) : undefined,
      completeness: numberOrUndefined(row.completeness) ?? 0,
      conditions: row.conditions,
      confirmedInCall: row.confirmed_in_call,
      warnings: row.warnings,
      createdAt: iso(row.created_at as string | Date),
    }),
  );

  return {
    campaign: CampaignSchema.parse({
      id: campaignRow.id,
      sessionId: campaignRow.session_id,
      repairSpecId: campaignRow.repair_spec_id,
      shopIds: calls.map((call) => call.shopId),
      status: campaignRow.status,
      startedAt: iso(campaignRow.started_at),
      completedAt: iso(campaignRow.completed_at),
      mode: campaignRow.mode,
    }),
    spec: RepairSpecSchema.parse(campaignRow.spec_snapshot),
    shops: shopRows.map((row) =>
      ShopSchema.parse({
        id: row.id,
        name: row.name,
        phone: row.phone ?? "",
        phoneVerified: Boolean(row.phone_verified),
        address: row.address ?? "",
        website: row.website ?? undefined,
        hours: row.hours ?? undefined,
        discoverySource: row.discovery_source,
      }),
    ),
    calls,
    quotes,
    evidence: evidenceRows.map((row) =>
      EvidenceSpanSchema.parse({
        id: row.id,
        callId: row.call_id,
        fieldName: row.field_name,
        turnIndex: row.turn_index,
        speaker: row.speaker,
        transcriptText: row.transcript_text,
        timeSeconds: numberOrUndefined(row.time_seconds) ?? 0,
      }),
    ),
    negotiations: negotiationRows.map((row) =>
      NegotiationSchema.parse({
        id: row.id,
        campaignId: row.campaign_id,
        shopId: row.shop_id,
        originalQuoteId: row.original_quote_id,
        leverageQuoteId: row.leverage_quote_id,
        revisedQuoteId: row.revised_quote_id ?? undefined,
        asks: row.asks,
        approvedByUser: true,
        outcome: row.outcome,
        createdAt: iso(row.created_at as string | Date),
      }),
    ),
  };
}
