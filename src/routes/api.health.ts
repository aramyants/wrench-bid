import { createFileRoute } from "@tanstack/react-router";
import { checkDatabase } from "@/lib/wrenchbid/server/db.server";
import { getPublicCapabilities, getServerEnvironment } from "@/lib/wrenchbid/server/env.server";
import { jsonResponse } from "@/lib/wrenchbid/server/project-session.server";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const capabilities = getPublicCapabilities();
        let database: { ok: boolean; latencyMs?: number; error?: string } = { ok: false };
        if (capabilities.database) {
          try {
            database = { ok: true, ...(await checkDatabase()) };
          } catch {
            database = { ok: false, error: "unavailable" };
          }
        } else {
          database = { ok: false, error: "not_configured" };
        }

        const ready = database.ok;
        return jsonResponse(
          {
            status: ready ? "ready" : "degraded",
            version: process.env.npm_package_version ?? "0.0.0",
            environment: getServerEnvironment().NODE_ENV,
            database,
            capabilities,
          },
          { status: ready ? 200 : 503 },
        );
      },
    },
  },
});
