import { createFileRoute } from "@tanstack/react-router";
import { apiHandler } from "@/lib/wrenchbid/server/api.server";
import { getCampaignSnapshot } from "@/lib/wrenchbid/server/campaigns.server";
import {
  jsonResponse,
  requireExistingProjectSession,
} from "@/lib/wrenchbid/server/project-session.server";

export const Route = createFileRoute("/api/campaigns/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        apiHandler(async () => {
          const project = await requireExistingProjectSession(request);
          const snapshot = await getCampaignSnapshot(project.projectId, params.id);
          if (!snapshot) throw new Response("Campaign not found", { status: 404 });
          return jsonResponse(snapshot, { setCookie: project.setCookie });
        }),
    },
  },
});
