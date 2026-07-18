import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ShopSchema, type Shop } from "../types";
import { getDatabase } from "./db.server";
import { getServerEnvironment } from "./env.server";

const TavilyResponseSchema = z.object({
  request_id: z.string().optional(),
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string().url(),
      content: z.string(),
      score: z.number(),
    }),
  ),
});

function extractPhone(text: string) {
  const match = /(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})/.exec(text);
  return match ? `+1${match[1]}${match[2]}${match[3]}` : "";
}

function extractAddress(text: string) {
  return (
    /\b\d{1,6}\s+[A-Za-z0-9 .'-]+(?:Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Lane|Ln|Highway|Hwy)\b[^.;\n]*/i
      .exec(text)?.[0]
      ?.slice(0, 220) ?? "Address needs verification"
  );
}

export async function discoverRepairShops(
  projectId: string,
  sessionId: string,
  query: string,
): Promise<Shop[]> {
  const environment = getServerEnvironment();
  if (!environment.TAVILY_API_KEY) {
    throw new Response("Tavily is not configured", { status: 503 });
  }
  const normalizedQuery = query.trim().slice(0, 400);
  if (normalizedQuery.length < 5) throw new Response("Search query is too short", { status: 400 });

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      authorization: `Bearer ${environment.TAVILY_API_KEY}`,
      "content-type": "application/json",
      "x-project-id": projectId,
      "x-session-id": sessionId,
    },
    body: JSON.stringify({
      query: normalizedQuery,
      topic: "general",
      search_depth: "basic",
      max_results: 10,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const retryAfter = response.headers.get("retry-after");
    throw new Response(
      response.status === 429
        ? "Shop discovery is rate-limited; try again later"
        : "Shop discovery failed",
      {
        status: response.status === 429 ? 429 : 502,
        headers: retryAfter ? { "retry-after": retryAfter } : undefined,
      },
    );
  }

  const payload = TavilyResponseSchema.parse(await response.json());
  const candidates = payload.results
    .filter((result) => result.score >= 0.35)
    .map((result) => ({
      id: randomUUID() as string,
      name: result.title
        .replace(/\s*[|–—-].*$/, "")
        .trim()
        .slice(0, 120),
      phone: extractPhone(`${result.title} ${result.content}`),
      phoneVerified: false,
      address: extractAddress(result.content),
      website: result.url,
      discoverySource: "tavily" as const,
      sourceUrl: result.url,
      score: result.score,
    }))
    .filter(
      (shop, index, shops) =>
        shops.findIndex(
          (candidate) =>
            candidate.website === shop.website ||
            (Boolean(shop.phone) && candidate.phone === shop.phone),
        ) === index,
    );

  const sql = getDatabase();
  await sql.begin(async (transaction) => {
    for (const shop of candidates) {
      const [existing] = await transaction<Array<{ id: string }>>`
        SELECT id FROM shops
        WHERE project_id = ${projectId}::uuid
          AND (
            (${shop.phone || null}::text IS NOT NULL AND phone = ${shop.phone || null})
            OR website = ${shop.website}
          )
        LIMIT 1
      `;
      if (existing) {
        shop.id = existing.id;
      } else {
        await transaction`
          INSERT INTO shops (
            id, project_id, name, phone, phone_verified, address, website,
            discovery_source, source_url, metadata
          ) VALUES (
            ${shop.id}::uuid,
            ${projectId}::uuid,
            ${shop.name},
            ${shop.phone || null},
            false,
            ${shop.address},
            ${shop.website},
            'tavily',
            ${shop.sourceUrl},
            ${transaction.json({ score: shop.score, requestId: payload.request_id })}
          )
        `;
      }
      const linked = await transaction`
        INSERT INTO session_shops (session_id, shop_id)
        SELECT session.id, shop.id
        FROM repair_sessions session
        JOIN shops shop ON shop.id = ${shop.id}::uuid
        WHERE session.id = ${sessionId}::uuid
          AND session.project_id = ${projectId}::uuid
          AND session.deleted_at IS NULL
          AND shop.project_id = ${projectId}::uuid
        ON CONFLICT (session_id, shop_id) DO NOTHING
        RETURNING shop_id
      `;
      if (linked.length === 0) {
        const [ownedLink] = await transaction`
          SELECT 1
          FROM session_shops selection
          JOIN repair_sessions session ON session.id = selection.session_id
          JOIN shops shop ON shop.id = selection.shop_id
          WHERE selection.session_id = ${sessionId}::uuid
            AND selection.shop_id = ${shop.id}::uuid
            AND session.project_id = ${projectId}::uuid
            AND session.deleted_at IS NULL
            AND shop.project_id = ${projectId}::uuid
          LIMIT 1
        `;
        if (!ownedLink) throw new Response("Request or shop ownership changed", { status: 403 });
      }
    }
    await transaction`
      INSERT INTO audit_events (id, project_id, session_id, event_type, message, metadata)
      VALUES (
        ${randomUUID()}::uuid,
        ${projectId}::uuid,
        ${sessionId}::uuid,
        'shops_discovered',
        ${`Tavily returned ${candidates.length} candidate repair shops`},
        ${transaction.json({ query: normalizedQuery, requestId: payload.request_id })}
      )
    `;
  });

  if (candidates.length === 0) return [];
  const persistedRows = await sql<Array<Record<string, unknown>>>`
    SELECT
      shop.id,
      shop.name,
      shop.phone,
      shop.phone_verified,
      shop.address,
      shop.website,
      shop.hours,
      shop.discovery_source
    FROM shops shop
    JOIN session_shops selection ON selection.shop_id = shop.id
    JOIN repair_sessions session ON session.id = selection.session_id
    WHERE selection.session_id = ${sessionId}::uuid
      AND session.project_id = ${projectId}::uuid
      AND session.deleted_at IS NULL
      AND shop.project_id = ${projectId}::uuid
      AND shop.id = ANY(${candidates.map((shop) => shop.id)}::uuid[])
  `;
  const persistedById = new Map(
    persistedRows.map((row) => [
      row.id as string,
      ShopSchema.parse({
        id: row.id,
        name: row.name,
        phone: row.phone ?? "",
        phoneVerified: row.phone_verified,
        address: row.address ?? "",
        website: row.website ?? undefined,
        hours: row.hours ?? undefined,
        discoverySource: row.discovery_source,
      }),
    ]),
  );
  return candidates
    .map((candidate) => persistedById.get(candidate.id))
    .filter((shop): shop is Shop => Boolean(shop));
}
