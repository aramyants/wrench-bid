import { createFileRoute } from "@tanstack/react-router";
import { apiHandler } from "@/lib/wrenchbid/server/api.server";
import { getDatabase } from "@/lib/wrenchbid/server/db.server";
import { getElevenLabsConversationAudio } from "@/lib/wrenchbid/server/elevenlabs.server";
import { requireExistingProjectSession } from "@/lib/wrenchbid/server/project-session.server";

export const Route = createFileRoute("/api/calls/$id/audio")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        apiHandler(async () => {
          const project = await requireExistingProjectSession(request);
          const sql = getDatabase();
          const [call] = await sql<Array<{ provider_conversation_id: string | null }>>`
            SELECT call.provider_conversation_id
            FROM calls call
            JOIN campaigns campaign ON campaign.id = call.campaign_id
            JOIN repair_sessions session ON session.id = campaign.session_id
            WHERE call.id = ${params.id}::uuid
              AND session.project_id = ${project.projectId}::uuid
              AND session.deleted_at IS NULL
            LIMIT 1
          `;
          if (!call?.provider_conversation_id) {
            throw new Response("Conversation audio is unavailable", { status: 404 });
          }
          const upstream = await getElevenLabsConversationAudio(call.provider_conversation_id);
          const headers = new Headers({
            "content-type": upstream.headers.get("content-type") ?? "audio/mpeg",
            "cache-control": "private, no-store",
            "content-disposition": `inline; filename="wrenchbid-${params.id}.mp3"`,
            vary: "Cookie",
          });
          return new Response(upstream.body, { status: 200, headers });
        }),
    },
  },
});
