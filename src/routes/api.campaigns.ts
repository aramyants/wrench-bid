import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { apiHandler } from "@/lib/wrenchbid/server/api.server";
import {
  createCampaign,
  dispatchCampaign,
  getCampaignSnapshot,
} from "@/lib/wrenchbid/server/campaigns.server";
import {
  assertSameOrigin,
  jsonResponse,
  requireExistingProjectSession,
} from "@/lib/wrenchbid/server/project-session.server";

const CampaignInputSchema = z.object({
  sessionId: z.string().uuid(),
  shopIds: z.array(z.string().uuid()).min(3).max(10),
  aiDisclosureAccepted: z.literal(true),
  recordingConsentConfirmed: z.literal(true),
});

export const Route = createFileRoute("/api/campaigns")({
  server: {
    handlers: {
      POST: ({ request }) =>
        apiHandler(async () => {
          assertSameOrigin(request);
          const project = await requireExistingProjectSession(request);
          const input = CampaignInputSchema.parse(await request.json());
          const campaignId = await createCampaign({
            projectId: project.projectId,
            ...input,
            // A repair request has one launch intent. Deriving the key server-side makes a
            // refresh/lost-response retry safe instead of trusting ephemeral browser state.
            idempotencyKey: input.sessionId,
          });
          await dispatchCampaign(project.projectId, campaignId);
          const snapshot = await getCampaignSnapshot(project.projectId, campaignId);
          return jsonResponse(snapshot, { status: 201, setCookie: project.setCookie });
        }),
    },
  },
});
