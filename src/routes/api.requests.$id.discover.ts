import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { apiHandler } from "@/lib/wrenchbid/server/api.server";
import {
  assertSameOrigin,
  jsonResponse,
  requireExistingProjectSession,
} from "@/lib/wrenchbid/server/project-session.server";
import { getRequestSnapshot } from "@/lib/wrenchbid/server/requests.server";
import { discoverRepairShops } from "@/lib/wrenchbid/server/tavily.server";

const DiscoverySchema = z.object({ query: z.string().trim().min(5).max(400) });

export const Route = createFileRoute("/api/requests/$id/discover")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        apiHandler(async () => {
          assertSameOrigin(request);
          const project = await requireExistingProjectSession(request);
          const snapshot = await getRequestSnapshot(project.projectId, params.id);
          if (!snapshot) throw new Response("Request not found", { status: 404 });
          if (snapshot.spec.status !== "confirmed") {
            throw new Response("Confirm the RepairSpec before discovering shops", { status: 409 });
          }
          const input = DiscoverySchema.parse(await request.json());
          const shops = await discoverRepairShops(project.projectId, params.id, input.query);
          return jsonResponse({ shops }, { setCookie: project.setCookie });
        }),
    },
  },
});
