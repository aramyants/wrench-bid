import { getDatabase } from "./db.server";

function isNoAnswer(reason: string) {
  return reason === "no-answer" || reason === "busy";
}

export async function deferElevenLabsInitiationFailure(
  conversationId: string,
  failureReason: string,
) {
  const sql = getDatabase();
  await sql.begin(async (transaction) => {
    await transaction`
      DELETE FROM pending_provider_failures
      WHERE expires_at < now()
    `;
    await transaction`
      INSERT INTO pending_provider_failures (
        provider, provider_conversation_id, failure_reason
      ) VALUES (
        'elevenlabs', ${conversationId}, ${failureReason.slice(0, 500)}
      )
      ON CONFLICT (provider, provider_conversation_id) DO UPDATE
      SET
        failure_reason = EXCLUDED.failure_reason,
        received_at = now(),
        expires_at = now() + interval '24 hours'
    `;
  });
}

export async function reconcileElevenLabsInitiationFailure(callId: string, conversationId: string) {
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [pending] = await transaction<Array<{ failure_reason: string }>>`
      DELETE FROM pending_provider_failures
      WHERE provider = 'elevenlabs'
        AND provider_conversation_id = ${conversationId}
      RETURNING failure_reason
    `;
    if (!pending) return false;
    const noAnswer = isNoAnswer(pending.failure_reason);
    const [transitioned] = await transaction<Array<{ kind: "quote" | "negotiation" }>>`
      UPDATE calls
      SET
        status = ${noAnswer ? "no_answer" : "failed"},
        outcome = ${noAnswer ? "no_answer" : "failed"},
        failure_reason = ${pending.failure_reason},
        provider_conversation_id = COALESCE(provider_conversation_id, ${conversationId}),
        dispatch_completed_at = COALESCE(dispatch_completed_at, now()),
        completed_at = now(),
        updated_at = now()
      WHERE id = ${callId}::uuid
        AND status NOT IN ('completed', 'declined', 'no_answer', 'failed', 'waiting_callback')
      RETURNING kind
    `;
    if (transitioned?.kind === "negotiation") {
      await transaction`
        UPDATE negotiations
        SET outcome = 'failed', provider_conversation_id = COALESCE(
          provider_conversation_id,
          ${conversationId}
        )
        WHERE call_id = ${callId}::uuid AND outcome = 'pending'
      `;
    }
    return Boolean(transitioned);
  });
}
