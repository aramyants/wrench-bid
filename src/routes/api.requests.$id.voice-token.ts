import { randomUUID } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { apiHandler } from "@/lib/wrenchbid/server/api.server";
import { createIntakeConversationToken } from "@/lib/wrenchbid/server/elevenlabs.server";
import { getDatabase } from "@/lib/wrenchbid/server/db.server";
import {
  assertSameOrigin,
  jsonResponse,
  requireProjectSession,
} from "@/lib/wrenchbid/server/project-session.server";
import { getRequestSnapshot } from "@/lib/wrenchbid/server/requests.server";

const rateLimit = new Map<string, number[]>();

function checkRateLimit(projectId: string) {
  const cutoff = Date.now() - 60_000;
  const recent = (rateLimit.get(projectId) ?? []).filter((time) => time > cutoff);
  if (recent.length >= 5)
    throw new Response("Too many voice sessions; try again shortly", { status: 429 });
  recent.push(Date.now());
  rateLimit.set(projectId, recent);
}

export const Route = createFileRoute("/api/requests/$id/voice-token")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        apiHandler(async () => {
          assertSameOrigin(request);
          const project = await requireProjectSession(request);
          const snapshot = await getRequestSnapshot(project.projectId, params.id);
          if (!snapshot) throw new Response("Request not found", { status: 404 });
          if (snapshot.spec.status !== "draft") {
            throw new Response("Voice intake is closed for a confirmed RepairSpec", {
              status: 409,
            });
          }
          checkRateLimit(project.projectId);
          const token = await createIntakeConversationToken();
          const sql = getDatabase();
          await sql`
            INSERT INTO audit_events (id, project_id, session_id, event_type, message)
            VALUES (
              ${randomUUID()}::uuid,
              ${project.projectId}::uuid,
              ${params.id}::uuid,
              'voice_intake_started',
              'A private ElevenLabs intake token was issued'
            )
          `;
          return jsonResponse({ token }, { setCookie: project.setCookie });
        }),
    },
  },
});
