import { randomUUID } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { apiHandler } from "@/lib/wrenchbid/server/api.server";
import {
  assertSameOrigin,
  jsonResponse,
  requireExistingProjectSession,
} from "@/lib/wrenchbid/server/project-session.server";
import {
  confirmRepairSpec,
  registerIntakeConversation,
  updateDraftRepairSpec,
} from "@/lib/wrenchbid/server/requests.server";

const ActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update_spec"),
    path: z.string().min(1).max(80),
    value: z.union([
      z.string().max(1000),
      z.number().finite(),
      z
        .array(
          z.union([
            z.string().trim().min(3).max(500),
            z.object({
              id: z.string().uuid().optional(),
              description: z.string().trim().min(3).max(500),
              partsPreference: z
                .enum(["oem", "premium_aftermarket", "economy", "any"])
                .default("any"),
              customerSuppliedParts: z.boolean().default(false),
            }),
          ]),
        )
        .min(1)
        .max(20),
    ]),
    source: z.enum(["voice", "manual"]),
  }),
  z.object({ action: z.literal("confirm_spec") }),
  z.object({
    action: z.literal("register_voice_conversation"),
    conversationId: z
      .string()
      .trim()
      .min(8)
      .max(200)
      .regex(/^[A-Za-z0-9_-]+$/),
  }),
]);

export const Route = createFileRoute("/api/requests/$id/actions")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        apiHandler(async () => {
          assertSameOrigin(request);
          const project = await requireExistingProjectSession(request);
          const action = ActionSchema.parse(await request.json());
          if (action.action === "register_voice_conversation") {
            await registerIntakeConversation(project.projectId, params.id, action.conversationId);
            return jsonResponse({ registered: true }, { setCookie: project.setCookie });
          }
          const value =
            action.action === "update_spec" &&
            action.path === "operations" &&
            Array.isArray(action.value)
              ? action.value.map((operation) =>
                  typeof operation === "string"
                    ? {
                        id: randomUUID(),
                        description: operation,
                        partsPreference: "any" as const,
                        customerSuppliedParts: false,
                      }
                    : { ...operation, id: operation.id ?? randomUUID() },
                )
              : action.action === "update_spec"
                ? action.value
                : undefined;
          const spec =
            action.action === "confirm_spec"
              ? await confirmRepairSpec(project.projectId, params.id)
              : await updateDraftRepairSpec(
                  project.projectId,
                  params.id,
                  action.path,
                  value,
                  action.source,
                );
          return jsonResponse({ spec }, { setCookie: project.setCookie });
        }),
    },
  },
});
