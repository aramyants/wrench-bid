import { createFileRoute } from "@tanstack/react-router";
import { apiHandler } from "@/lib/wrenchbid/server/api.server";
import {
  ingestElevenLabsWebhook,
  readElevenLabsWebhookBody,
} from "@/lib/wrenchbid/server/elevenlabs-webhook.server";
import { verifyElevenLabsWebhook } from "@/lib/wrenchbid/server/elevenlabs.server";
import { jsonResponse } from "@/lib/wrenchbid/server/project-session.server";

export const Route = createFileRoute("/api/webhooks/elevenlabs")({
  server: {
    handlers: {
      POST: ({ request }) =>
        apiHandler(async () => {
          const rawBody = await readElevenLabsWebhookBody(request);
          verifyElevenLabsWebhook(rawBody, request.headers.get("elevenlabs-signature"));
          const result = await ingestElevenLabsWebhook(rawBody);
          return jsonResponse(result);
        }),
    },
  },
});
