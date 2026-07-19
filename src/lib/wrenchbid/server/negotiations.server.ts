import { randomUUID } from "node:crypto";
import { isVerifiedCallDestination } from "../phone";
import { validateGenuineLeverage, type NegotiationQuoteTerms } from "../negotiation-policy";
import type { NegotiationAsk } from "../types";
import { AUTO_REPAIR_VERTICAL } from "../verticals/auto-repair";
import { getDatabase } from "./db.server";
import { startElevenLabsOutboundCall } from "./elevenlabs.server";
import { getServerEnvironment } from "./env.server";
import { reconcileElevenLabsInitiationFailure } from "./provider-failures.server";

const NEGOTIATION_SAFETY_FAILURE =
  "Negotiation dispatch blocked by the verified-phone, disclosure, recording-consent, or suppression policy";

type NegotiationQuoteRow = {
  id: string;
  shop_id: string;
  shop_name: string;
  phone: string | null;
  phone_verified: boolean;
  status: "complete" | "incomplete" | "range_only" | "declined";
  subtotal: string | null;
  tax: string | null;
  total: string | null;
  currency: string;
  warranty_text: string | null;
  warranty_days: number | null;
  earliest_date: string | null;
  valid_until: string | null;
  completeness: string;
  conditions: unknown;
  confirmed_in_call: boolean;
  warnings: unknown;
  call_id: string;
  ai_disclosure_accepted: boolean;
  recording_consent_confirmed: boolean;
  session_id: string;
};

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function parseSuppressedPhoneNumbers(value: string) {
  return value
    .split(",")
    .map((phone) => phone.trim())
    .filter(Boolean);
}

async function claimNegotiationForDispatch(input: {
  projectId: string;
  callId: string;
  suppressedPhones: string[];
}) {
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [dispatchableSession] = await transaction<Array<{ id: string }>>`
      SELECT session.id
      FROM calls call
      JOIN campaigns campaign ON campaign.id = call.campaign_id
      JOIN repair_sessions session ON session.id = campaign.session_id
      WHERE call.id = ${input.callId}::uuid
        AND session.project_id = ${input.projectId}::uuid
        AND session.deleted_at IS NULL
        AND session.deletion_requested_at IS NULL
      FOR UPDATE OF session
    `;
    if (!dispatchableSession) return undefined;

    const [claimed] = await transaction<
      Array<{
        id: string;
        phone: string;
        shop_name: string;
        recording_consent_confirmed: boolean;
      }>
    >`
      UPDATE calls call
      SET dispatch_started_at = now(), updated_at = now()
      FROM campaigns campaign, repair_sessions session, shops shop
      WHERE call.id = ${input.callId}::uuid
        AND call.campaign_id = campaign.id
        AND campaign.session_id = session.id
        AND call.shop_id = shop.id
        AND session.project_id = ${input.projectId}::uuid
        AND session.deleted_at IS NULL
        AND session.deletion_requested_at IS NULL
        AND call.kind = 'negotiation'
        AND call.status = 'queued'
        AND call.dispatch_started_at IS NULL
        AND campaign.ai_disclosure_accepted IS TRUE
        AND campaign.recording_consent_confirmed IS TRUE
        AND call.destination_phone ~ '^[+][1-9][0-9]{7,14}$'
        AND NOT (call.destination_phone = ANY(${input.suppressedPhones}::text[]))
      RETURNING
        call.id,
        call.destination_phone AS phone,
        shop.name AS shop_name,
        campaign.recording_consent_confirmed
    `;
    return claimed;
  });
}

async function failUnclaimedNegotiation(callId: string, negotiationId: string) {
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [failed] = await transaction<Array<{ id: string }>>`
      UPDATE calls
      SET
        status = 'failed',
        outcome = 'failed',
        failure_reason = ${NEGOTIATION_SAFETY_FAILURE},
        dispatch_completed_at = now(),
        completed_at = now(),
        updated_at = now()
      WHERE id = ${callId}::uuid
        AND kind = 'negotiation'
        AND status = 'queued'
        AND dispatch_started_at IS NULL
      RETURNING id
    `;
    if (!failed) return false;
    await transaction`
      UPDATE negotiations
      SET outcome = 'failed'
      WHERE id = ${negotiationId}::uuid
        AND outcome = 'pending'
    `;
    return true;
  });
}

export async function startNegotiation(input: {
  projectId: string;
  campaignId: string;
  originalQuoteId: string;
  leverageQuoteId: string;
  asks: NegotiationAsk[];
}) {
  if (input.originalQuoteId === input.leverageQuoteId) {
    throw new Response("The leverage quote must be a different stored quote", { status: 422 });
  }
  const environment = getServerEnvironment();
  if (
    !environment.OUTBOUND_CALLS_ENABLED ||
    !environment.ELEVENLABS_API_KEY ||
    !environment.ELEVENLABS_NEGOTIATOR_AGENT_ID ||
    !environment.ELEVENLABS_PHONE_NUMBER_ID ||
    !environment.ELEVENLABS_WEBHOOK_SECRET
  ) {
    throw new Response(
      "Negotiation calling and verified result ingestion are not fully configured",
      {
        status: 503,
      },
    );
  }
  const sql = getDatabase();
  const quotes = await sql<Array<NegotiationQuoteRow>>`
    SELECT
      quote.id,
      quote.shop_id,
      shop.name AS shop_name,
      call.destination_phone AS phone,
      (call.destination_phone IS NOT NULL) AS phone_verified,
      quote.status,
      quote.subtotal,
      quote.tax,
      quote.total,
      quote.currency,
      quote.warranty_text,
      quote.warranty_days,
      quote.earliest_date,
      quote.valid_until,
      quote.completeness,
      quote.conditions,
      quote.confirmed_in_call,
      quote.warnings,
      quote.call_id,
      campaign.ai_disclosure_accepted,
      campaign.recording_consent_confirmed,
      campaign.session_id
    FROM quotes quote
    JOIN calls call ON call.id = quote.call_id
    JOIN campaigns campaign ON campaign.id = call.campaign_id
    JOIN repair_sessions session ON session.id = campaign.session_id
    JOIN shops shop ON shop.id = quote.shop_id
    WHERE campaign.id = ${input.campaignId}::uuid
      AND session.project_id = ${input.projectId}::uuid
      AND quote.id = ANY(${[input.originalQuoteId, input.leverageQuoteId]}::uuid[])
      AND quote.status = 'complete'
      AND quote.total IS NOT NULL
      AND quote.confirmed_in_call = true
  `;
  if (quotes.length !== 2) {
    throw new Response("Both negotiation quotes must be complete and belong to this campaign", {
      status: 422,
    });
  }
  const original = quotes.find((quote) => quote.id === input.originalQuoteId);
  const leverage = quotes.find((quote) => quote.id === input.leverageQuoteId);
  if (!original || !leverage) throw new Response("Negotiation quotes not found", { status: 404 });
  if (original.shop_id === leverage.shop_id) {
    throw new Response("Leverage must come from a different repair shop", { status: 422 });
  }

  const itemRows = await sql<
    Array<{
      quote_id: string;
      category: NegotiationQuoteTerms["items"][number]["category"];
      amount: string;
    }>
  >`
    SELECT quote_id, category, amount
    FROM quote_items
    WHERE quote_id = ANY(${[original.id, leverage.id]}::uuid[])
    ORDER BY quote_id, sort_order, id
  `;
  const terms = (quote: NegotiationQuoteRow): NegotiationQuoteTerms => ({
    status: quote.status,
    total: quote.total == null ? undefined : Number(quote.total),
    currency: quote.currency,
    validUntil: quote.valid_until ?? undefined,
    completeness: Number(quote.completeness),
    confirmedInCall: quote.confirmed_in_call,
    warnings: stringArray(quote.warnings),
    warrantyDays: quote.warranty_days ?? undefined,
    earliestDate: quote.earliest_date ?? undefined,
    items: itemRows
      .filter((item) => item.quote_id === quote.id)
      .map((item) => ({ category: item.category, amount: Number(item.amount) })),
  });
  const originalTerms = terms(original);
  const leverageTerms = terms(leverage);
  const leverageValidation = validateGenuineLeverage(originalTerms, leverageTerms);
  if (!leverageValidation.ok) {
    throw new Response(
      `The competing quote is not valid leverage: ${leverageValidation.reasons.join(", ")}`,
      { status: 422 },
    );
  }
  const targetPhone = original.phone;
  if (!isVerifiedCallDestination(targetPhone, original.phone_verified)) {
    throw new Response("The target shop phone number is not verified", { status: 422 });
  }
  if (!original.ai_disclosure_accepted || !original.recording_consent_confirmed) {
    throw new Response("AI disclosure and recording-consent checks must be confirmed", {
      status: 422,
    });
  }
  const suppressedPhones = parseSuppressedPhoneNumbers(environment.SUPPRESSED_PHONE_NUMBERS);
  if (suppressedPhones.includes(targetPhone)) {
    throw new Response("The target destination is on the operator suppression list", {
      status: 422,
    });
  }

  const negotiationId = randomUUID();
  const callId = randomUUID();
  const approvedAt = new Date().toISOString();
  await sql.begin(async (transaction) => {
    await transaction`
      INSERT INTO calls (
        id, campaign_id, shop_id, destination_phone, kind, style_profile, status,
        current_objective, created_at, updated_at
      ) VALUES (
        ${callId}::uuid,
        ${input.campaignId}::uuid,
        ${original.shop_id}::uuid,
        ${targetPhone},
        'negotiation',
        'closer',
        'queued',
        'Request only the user-approved improvements using a genuine stored quote',
        ${approvedAt},
        ${approvedAt}
      )
    `;
    await transaction`
      INSERT INTO negotiations (
        id, campaign_id, call_id, shop_id, original_quote_id, leverage_quote_id,
        asks, approved_at, outcome, created_at
      ) VALUES (
        ${negotiationId}::uuid,
        ${input.campaignId}::uuid,
        ${callId}::uuid,
        ${original.shop_id}::uuid,
        ${original.id}::uuid,
        ${leverage.id}::uuid,
        ${transaction.json(input.asks)},
        ${approvedAt},
        'pending',
        ${approvedAt}
      )
    `;
    await transaction`
      INSERT INTO audit_events (id, project_id, session_id, event_type, message, metadata)
      VALUES (
        ${randomUUID()}::uuid,
        ${input.projectId}::uuid,
        ${original.session_id}::uuid,
        'negotiation_approved',
        'User approved a negotiation using a genuine stored competing quote',
        ${transaction.json({
          negotiationId,
          originalQuoteId: original.id,
          leverageQuoteId: leverage.id,
          asks: input.asks,
        })}
      )
    `;
  });

  const claimed = await claimNegotiationForDispatch({
    projectId: input.projectId,
    callId,
    suppressedPhones,
  });
  if (!claimed) {
    const failed = await failUnclaimedNegotiation(callId, negotiationId);
    if (failed) {
      throw new Response(NEGOTIATION_SAFETY_FAILURE, { status: 422 });
    }
    throw new Response("The negotiation call is no longer queued for dispatch", { status: 409 });
  }

  try {
    const result = await startElevenLabsOutboundCall({
      toNumber: claimed.phone,
      agentId: environment.ELEVENLABS_NEGOTIATOR_AGENT_ID,
      recordingEnabled: claimed.recording_consent_confirmed,
      dynamicVariables: {
        wrenchbid_call_id: callId,
        negotiation_id: negotiationId,
        target_shop_name: claimed.shop_name,
        original_quote_id: original.id,
        original_total: Number(original.total),
        original_currency: original.currency,
        original_warranty: original.warranty_text ?? "not captured",
        original_appointment: original.earliest_date ?? "not captured",
        original_valid_until: original.valid_until ?? "not captured",
        original_conditions_json: JSON.stringify(stringArray(original.conditions)),
        original_itemization_json: JSON.stringify(originalTerms.items),
        leverage_quote_id: leverage.id,
        leverage_shop_name: leverage.shop_name,
        leverage_total: Number(leverage.total),
        leverage_currency: leverage.currency,
        leverage_warranty: leverage.warranty_text ?? "not captured",
        leverage_appointment: leverage.earliest_date ?? "not captured",
        leverage_valid_until: leverage.valid_until ?? "not captured",
        leverage_conditions_json: JSON.stringify(stringArray(leverage.conditions)),
        leverage_itemization_json: JSON.stringify(leverageTerms.items),
        approved_asks: input.asks.join(", "),
        identity_policy: AUTO_REPAIR_VERTICAL.agentPolicy.identity,
        disclosure_policy: AUTO_REPAIR_VERTICAL.agentPolicy.disclosure,
        scope_policy: AUTO_REPAIR_VERTICAL.agentPolicy.scope,
        quote_integrity_policy: AUTO_REPAIR_VERTICAL.agentPolicy.quoteIntegrity,
        commitment_policy: AUTO_REPAIR_VERTICAL.agentPolicy.commitment,
        prompt_injection_policy: AUTO_REPAIR_VERTICAL.agentPolicy.promptInjection,
      },
    });
    await sql.begin(async (transaction) => {
      await transaction`
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
        WHERE id = ${callId}::uuid
      `;
      await transaction`
        UPDATE negotiations
        SET provider_conversation_id = COALESCE(
          provider_conversation_id,
          ${result.conversationId}
        )
        WHERE id = ${negotiationId}::uuid
      `;
    });
    await reconcileElevenLabsInitiationFailure(callId, result.conversationId);
  } catch (error) {
    const reason =
      error instanceof Response
        ? await error.text()
        : "Ambiguous provider dispatch failure; not retried";
    await sql.begin(async (transaction) => {
      await transaction`
        UPDATE calls
        SET status = 'failed', outcome = 'failed', failure_reason = ${reason.slice(0, 500)},
            dispatch_completed_at = now(), completed_at = now(), updated_at = now()
        WHERE id = ${callId}::uuid
          AND status = 'queued'
      `;
      await transaction`
        UPDATE negotiations negotiation
        SET outcome = 'failed'
        WHERE negotiation.id = ${negotiationId}::uuid
          AND negotiation.outcome = 'pending'
          AND EXISTS (
            SELECT 1 FROM calls call
            WHERE call.id = ${callId}::uuid AND call.status = 'failed'
          )
      `;
    });
    throw error;
  }

  return { negotiationId, callId };
}
