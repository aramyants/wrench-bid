import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { NegotiationAskSchema } from "@/lib/wrenchbid/types";
import { apiHandler } from "@/lib/wrenchbid/server/api.server";
import { startNegotiation } from "@/lib/wrenchbid/server/negotiations.server";
import {
  assertSameOrigin,
  jsonResponse,
  requireProjectSession,
} from "@/lib/wrenchbid/server/project-session.server";

const NegotiationInputSchema = z.object({
  campaignId: z.string().uuid(),
  originalQuoteId: z.string().uuid(),
  leverageQuoteId: z.string().uuid(),
  asks: z.array(NegotiationAskSchema).min(1).max(5),
});

export const Route = createFileRoute("/api/negotiations")({
  server: {
    handlers: {
      POST: ({ request }) =>
        apiHandler(async () => {
          assertSameOrigin(request);
          const project = await requireProjectSession(request);
          const input = NegotiationInputSchema.parse(await request.json());
          const result = await startNegotiation({ projectId: project.projectId, ...input });
          return jsonResponse(result, { status: 201, setCookie: project.setCookie });
        }),
    },
  },
});
