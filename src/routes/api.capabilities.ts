import { createFileRoute } from "@tanstack/react-router";
import { getPublicCapabilities } from "@/lib/wrenchbid/server/env.server";
import { jsonResponse } from "@/lib/wrenchbid/server/project-session.server";

export const Route = createFileRoute("/api/capabilities")({
  server: {
    handlers: {
      GET: async () => jsonResponse({ capabilities: getPublicCapabilities() }),
    },
  },
});
