import postgres from "postgres";
import { requireDatabaseUrl } from "./env.server";

type SqlClient = ReturnType<typeof postgres>;

const globalDatabase = globalThis as typeof globalThis & {
  __wrenchBidSql?: SqlClient;
};

export function getDatabase(): SqlClient {
  if (!globalDatabase.__wrenchBidSql) {
    globalDatabase.__wrenchBidSql = postgres(requireDatabaseUrl(), {
      max: Number(process.env.DB_POOL_SIZE ?? 10),
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
      onnotice: () => undefined,
    });
  }
  return globalDatabase.__wrenchBidSql;
}

export async function checkDatabase() {
  const startedAt = performance.now();
  await getDatabase()`SELECT 1`;
  return { latencyMs: Math.round(performance.now() - startedAt) };
}
