import { createFileRoute } from "@tanstack/react-router";
import { apiHandler } from "@/lib/wrenchbid/server/api.server";
import {
  assertSameOrigin,
  jsonResponse,
  requireProjectSession,
} from "@/lib/wrenchbid/server/project-session.server";
import { deleteRepairSession, getRequestSnapshot } from "@/lib/wrenchbid/server/requests.server";

export const Route = createFileRoute("/api/requests/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        apiHandler(async () => {
          const project = await requireProjectSession(request);
          const snapshot = await getRequestSnapshot(project.projectId, params.id);
          if (!snapshot) throw new Response("Request not found", { status: 404 });
          return jsonResponse(snapshot, { setCookie: project.setCookie });
        }),
      DELETE: ({ request, params }) =>
        apiHandler(async () => {
          assertSameOrigin(request);
          const project = await requireProjectSession(request);
          const deleted = await deleteRepairSession(project.projectId, params.id);
          if (!deleted) throw new Response("Request not found", { status: 404 });
          return jsonResponse({ deleted: true }, { setCookie: project.setCookie });
        }),
    },
  },
});
