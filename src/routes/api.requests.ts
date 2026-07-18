import { createFileRoute } from "@tanstack/react-router";
import { apiHandler } from "@/lib/wrenchbid/server/api.server";
import {
  deleteStoredDocument,
  validateExtractAndStoreDocument,
} from "@/lib/wrenchbid/server/document-extraction.server";
import {
  assertSameOrigin,
  jsonResponse,
  requireProjectSession,
} from "@/lib/wrenchbid/server/project-session.server";
import { createRepairRequest, listRepairSessions } from "@/lib/wrenchbid/server/requests.server";

export const Route = createFileRoute("/api/requests")({
  server: {
    handlers: {
      GET: ({ request }) =>
        apiHandler(async () => {
          const project = await requireProjectSession(request);
          const sessions = await listRepairSessions(project.projectId);
          return jsonResponse({ sessions }, { setCookie: project.setCookie });
        }),
      POST: ({ request }) =>
        apiHandler(async () => {
          assertSameOrigin(request);
          const contentType = request.headers.get("content-type") ?? "";
          if (!contentType.includes("multipart/form-data")) {
            throw new Response("Expected multipart form data", { status: 415 });
          }
          const form = await request.formData();
          if (form.get("consent") !== "true") {
            throw new Response("Processing consent is required", { status: 422 });
          }
          const file = form.get("estimate");
          if (!(file instanceof File)) {
            throw new Response("A PDF estimate is required", { status: 400 });
          }

          const project = await requireProjectSession(request);
          const document = await validateExtractAndStoreDocument(file);
          try {
            const snapshot = await createRepairRequest(project.projectId, document);
            return jsonResponse(snapshot, {
              status: 201,
              setCookie: project.setCookie,
            });
          } catch (error) {
            await deleteStoredDocument(document.storageKey);
            throw error;
          }
        }),
    },
  },
});
