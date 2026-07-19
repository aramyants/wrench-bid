import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run migrations");
}

const sql = postgres(databaseUrl, { max: 1, prepare: false });
const migrationDirectory = path.resolve("migrations");
let migrationLockHeld = false;

try {
  await sql`SELECT pg_advisory_lock(hashtext('wrenchbid:migrations'))`;
  migrationLockHeld = true;
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(migrationDirectory)).filter((file) => file.endsWith(".sql")).sort();

  for (const file of files) {
    const applied = await sql`
      SELECT 1 FROM schema_migrations WHERE version = ${file} LIMIT 1
    `;
    if (applied.length > 0) continue;

    const contents = await readFile(path.join(migrationDirectory, file), "utf8");
    await sql.begin(async (transaction) => {
      await transaction.unsafe(contents);
      await transaction`
        INSERT INTO schema_migrations (version) VALUES (${file})
        ON CONFLICT (version) DO NOTHING
      `;
    });
    console.log(`Applied ${file}`);
  }
} finally {
  if (migrationLockHeld) {
    await sql`SELECT pg_advisory_unlock(hashtext('wrenchbid:migrations'))`;
  }
  await sql.end();
}
