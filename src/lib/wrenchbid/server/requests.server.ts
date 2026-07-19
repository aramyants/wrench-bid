import { createHash, randomUUID } from "node:crypto";
import type { RequestSnapshot } from "../api-types";
import { RepairSpecSchema, SessionSchema, ShopSchema, type RepairSpec } from "../types";
import { AUTO_REPAIR_VERTICAL } from "../verticals/auto-repair";
import { getDatabase } from "./db.server";
import {
  buildRepairSpecFromText,
  deleteStoredDocument,
  type StoredDocument,
} from "./document-extraction.server";
import { deleteElevenLabsConversation } from "./elevenlabs.server";

type SpecRow = {
  payload: unknown;
  status: "draft" | "confirmed";
  spec_hash: string | null;
  confirmed_at: Date | null;
};

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashRepairSpec(spec: unknown) {
  return createHash("sha256").update(canonicalize(spec)).digest("hex");
}

export async function createRepairRequest(
  projectId: string,
  document: StoredDocument,
): Promise<RequestSnapshot> {
  const sql = getDatabase();
  const sessionId = randomUUID();
  const spec = buildRepairSpecFromText(sessionId, document.extractedText, document.originalName);
  const session = SessionSchema.parse({
    id: sessionId,
    mode: "live",
    status: "extracted",
    createdAt: new Date().toISOString(),
  });

  try {
    await sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO repair_sessions (id, project_id, vertical_id, mode, status, created_at, updated_at)
        VALUES (
          ${session.id}::uuid,
          ${projectId}::uuid,
          ${AUTO_REPAIR_VERTICAL.id},
          ${session.mode},
          ${session.status},
          ${session.createdAt},
          ${session.createdAt}
        )
      `;
      await transaction`
        INSERT INTO source_documents (
          id, session_id, original_name, mime_type, size_bytes, sha256,
          storage_key, extracted_text, extraction_status
        ) VALUES (
          ${document.id}::uuid,
          ${session.id}::uuid,
          ${document.originalName},
          ${document.mimeType},
          ${document.sizeBytes},
          ${document.sha256},
          ${document.storageKey},
          ${document.extractedText},
          'completed'
        )
      `;
      await transaction`
        INSERT INTO repair_specs (
          id, session_id, version, status, schema_version, payload, evidence, created_at
        ) VALUES (
          ${spec.id}::uuid,
          ${session.id}::uuid,
          ${spec.version},
          'draft',
          ${AUTO_REPAIR_VERTICAL.schemaVersion},
          ${transaction.json(spec)},
          ${transaction.json(spec.fieldMeta)},
          ${spec.createdAt}
        )
      `;
      await transaction`
        INSERT INTO audit_events (id, project_id, session_id, event_type, message, metadata)
        VALUES (
          ${randomUUID()}::uuid,
          ${projectId}::uuid,
          ${session.id}::uuid,
          'document_extracted',
          'PDF estimate uploaded, hashed, stored, and extracted',
          ${transaction.json({
            documentId: document.id,
            sha256: document.sha256,
            extractedCharacters: document.extractedText.length,
          })}
        )
      `;
    });
  } catch (error) {
    await deleteStoredDocument(document.storageKey);
    throw error;
  }

  return {
    session,
    spec,
    documents: [
      {
        id: document.id,
        originalName: document.originalName,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        sha256: document.sha256,
        extractionStatus: "completed",
        createdAt: session.createdAt,
      },
    ],
    shops: [],
  };
}

export async function listRepairSessions(projectId: string) {
  const sql = getDatabase();
  const rows = await sql<
    Array<{
      id: string;
      mode: "demo" | "live";
      status: string;
      created_at: Date;
      campaign_id: string | null;
    }>
  >`
    SELECT session.id, session.mode, session.status, session.created_at, latest_campaign.id AS campaign_id
    FROM repair_sessions session
    LEFT JOIN LATERAL (
      SELECT campaign.id
      FROM campaigns campaign
      WHERE campaign.session_id = session.id
      ORDER BY campaign.created_at DESC
      LIMIT 1
    ) latest_campaign ON true
    WHERE session.project_id = ${projectId}::uuid AND session.deleted_at IS NULL
    ORDER BY session.created_at DESC
    LIMIT 100
  `;
  return rows.map((row) => ({
    ...SessionSchema.parse({
      id: row.id,
      mode: row.mode,
      status: row.status,
      createdAt: iso(row.created_at),
    }),
    campaignId: row.campaign_id ?? undefined,
  }));
}

export async function getRequestSnapshot(
  projectId: string,
  sessionId: string,
): Promise<RequestSnapshot | null> {
  const sql = getDatabase();
  const [sessionRow] = await sql<
    Array<{ id: string; mode: "demo" | "live"; status: string; created_at: Date }>
  >`
    SELECT id, mode, status, created_at
    FROM repair_sessions
    WHERE id = ${sessionId}::uuid
      AND project_id = ${projectId}::uuid
      AND deleted_at IS NULL
    LIMIT 1
  `;
  if (!sessionRow) return null;

  const [specRow] = await sql<SpecRow[]>`
    SELECT payload, status, spec_hash, confirmed_at
    FROM repair_specs
    WHERE session_id = ${sessionId}::uuid
    ORDER BY version DESC
    LIMIT 1
  `;
  if (!specRow) throw new Error("Session has no RepairSpec");

  const documentRows = await sql<
    Array<{
      id: string;
      original_name: string;
      mime_type: string;
      size_bytes: number;
      sha256: string;
      extraction_status: "pending" | "completed" | "failed";
      created_at: Date;
    }>
  >`
    SELECT id, original_name, mime_type, size_bytes, sha256, extraction_status, created_at
    FROM source_documents
    WHERE session_id = ${sessionId}::uuid
    ORDER BY created_at
  `;

  const shopRows = await sql<Array<Record<string, unknown>>>`
    SELECT
      s.id,
      s.name,
      s.phone,
      s.phone_verified,
      s.address,
      s.website,
      s.hours,
      s.discovery_source
    FROM shops s
    JOIN session_shops ss ON ss.shop_id = s.id
    WHERE ss.session_id = ${sessionId}::uuid
    ORDER BY s.name
  `;

  const payload = {
    ...(specRow.payload as Record<string, unknown>),
    status: specRow.status,
    specHash: specRow.spec_hash ?? undefined,
    confirmedAt: specRow.confirmed_at ? iso(specRow.confirmed_at) : undefined,
  };

  return {
    session: SessionSchema.parse({
      id: sessionRow.id,
      mode: sessionRow.mode,
      status: sessionRow.status,
      createdAt: iso(sessionRow.created_at),
    }),
    spec: RepairSpecSchema.parse(payload),
    documents: documentRows.map((row) => ({
      id: row.id,
      originalName: row.original_name,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      sha256: row.sha256,
      extractionStatus: row.extraction_status,
      createdAt: iso(row.created_at),
    })),
    shops: shopRows.map((row) =>
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
    ),
  };
}

export async function updateDraftRepairSpec(
  projectId: string,
  sessionId: string,
  path: string,
  value: unknown,
  source: "voice" | "manual",
) {
  const allowed = new Set([
    "vehicle.year",
    "vehicle.make",
    "vehicle.model",
    "vehicle.trim",
    "vehicle.mileage",
    "vehicle.vinLast8",
    "location.city",
    "location.region",
    "location.postal",
    "completionByDays",
    "operations",
  ]);
  if (!allowed.has(path)) throw new Response("Unsupported RepairSpec field", { status: 400 });
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [row] = await transaction<
      Array<{ id: string; status: "draft" | "confirmed"; payload: unknown }>
    >`
      SELECT rs.id, rs.status, rs.payload
      FROM repair_specs rs
      JOIN repair_sessions session ON session.id = rs.session_id
      WHERE session.id = ${sessionId}::uuid
        AND session.project_id = ${projectId}::uuid
        AND session.deleted_at IS NULL
      ORDER BY rs.version DESC
      LIMIT 1
      FOR UPDATE OF rs
    `;
    if (!row) throw new Response("Request not found", { status: 404 });
    if (row.status !== "draft") {
      throw new Response("A confirmed RepairSpec is immutable", { status: 409 });
    }

    const next = structuredClone(RepairSpecSchema.parse(row.payload)) as RepairSpec;
    const segments = path.split(".");
    let target = next as unknown as Record<string, unknown>;
    for (const segment of segments.slice(0, -1)) {
      target = target[segment] as Record<string, unknown>;
    }
    target[segments.at(-1) as string] = value;
    next.fieldMeta[path] = { source, status: "verified", confidence: 1 };
    if (
      path.startsWith("location.") &&
      next.location.city.trim() &&
      next.location.region.trim() &&
      next.location.postal.trim()
    ) {
      next.fieldMeta.location = { source, status: "verified", confidence: 1 };
    }
    const parsed = RepairSpecSchema.parse(next);
    await transaction`
      UPDATE repair_specs
      SET payload = ${transaction.json(parsed)}, evidence = ${transaction.json(parsed.fieldMeta)}
      WHERE id = ${row.id}::uuid AND status = 'draft'
    `;
    await transaction`
      INSERT INTO audit_events (id, project_id, session_id, event_type, message, metadata)
      VALUES (
        ${randomUUID()}::uuid,
        ${projectId}::uuid,
        ${sessionId}::uuid,
        'spec_field_updated',
        ${`RepairSpec field ${path} confirmed by ${source}`},
        ${transaction.json({ path, source })}
      )
    `;
    return parsed;
  });
}

export async function confirmRepairSpec(projectId: string, sessionId: string) {
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [row] = await transaction<
      Array<{ id: string; status: "draft" | "confirmed"; payload: unknown }>
    >`
      SELECT rs.id, rs.status, rs.payload
      FROM repair_specs rs
      JOIN repair_sessions session ON session.id = rs.session_id
      WHERE session.id = ${sessionId}::uuid
        AND session.project_id = ${projectId}::uuid
        AND session.deleted_at IS NULL
      ORDER BY rs.version DESC
      LIMIT 1
      FOR UPDATE OF rs
    `;
    if (!row) throw new Response("Request not found", { status: 404 });
    const spec = RepairSpecSchema.parse(row.payload);
    if (row.status === "confirmed") return spec;

    const missing: string[] = [];
    if (spec.vehicle.year < 1980) missing.push("vehicle.year");
    if (!spec.vehicle.make.trim()) missing.push("vehicle.make");
    if (!spec.vehicle.model.trim()) missing.push("vehicle.model");
    if (spec.vehicle.mileage <= 0) missing.push("vehicle.mileage");
    if (spec.operations.length === 0) missing.push("operations");
    if (!spec.location.city || !spec.location.region || !spec.location.postal)
      missing.push("location");
    if (missing.length > 0) {
      throw new Response(`RepairSpec still needs confirmation: ${missing.join(", ")}`, {
        status: 422,
      });
    }

    const confirmedAt = new Date().toISOString();
    const canonical = { ...spec, status: "confirmed" as const, confirmedAt, specHash: undefined };
    const specHash = hashRepairSpec(canonical);
    const confirmed = RepairSpecSchema.parse({ ...canonical, specHash });
    const updated = await transaction`
      UPDATE repair_specs
      SET
        status = 'confirmed',
        payload = ${transaction.json(confirmed)},
        evidence = ${transaction.json(confirmed.fieldMeta)},
        spec_hash = ${specHash},
        confirmed_at = ${confirmedAt}
      WHERE id = ${row.id}::uuid AND status = 'draft'
      RETURNING id
    `;
    if (updated.length !== 1)
      throw new Response("RepairSpec confirmation conflict", { status: 409 });
    await transaction`
      UPDATE repair_sessions
      SET status = 'spec_confirmed', updated_at = now()
      WHERE id = ${sessionId}::uuid AND project_id = ${projectId}::uuid
    `;
    await transaction`
      INSERT INTO audit_events (id, project_id, session_id, event_type, message, metadata)
      VALUES (
        ${randomUUID()}::uuid,
        ${projectId}::uuid,
        ${sessionId}::uuid,
        'spec_confirmed',
        'RepairSpec version 1 confirmed and sealed',
        ${transaction.json({ specHash, version: spec.version })}
      )
    `;
    return confirmed;
  });
}

export async function deleteRepairSession(projectId: string, sessionId: string) {
  const sql = getDatabase();
  const documents = await sql<Array<{ storage_key: string }>>`
    SELECT document.storage_key
    FROM source_documents document
    JOIN repair_sessions session ON session.id = document.session_id
    WHERE session.id = ${sessionId}::uuid AND session.project_id = ${projectId}::uuid
  `;
  const conversations = await sql<Array<{ provider_conversation_id: string }>>`
    SELECT DISTINCT call.provider_conversation_id
    FROM calls call
    JOIN campaigns campaign ON campaign.id = call.campaign_id
    JOIN repair_sessions session ON session.id = campaign.session_id
    WHERE session.id = ${sessionId}::uuid
      AND session.project_id = ${projectId}::uuid
      AND call.provider = 'elevenlabs'
      AND call.provider_conversation_id IS NOT NULL
  `;
  await Promise.all(
    conversations.map((call) => deleteElevenLabsConversation(call.provider_conversation_id)),
  );
  await Promise.all(documents.map((document) => deleteStoredDocument(document.storage_key)));
  return sql.begin(async (transaction) => {
    const deleted = await transaction`
      DELETE FROM repair_sessions
      WHERE id = ${sessionId}::uuid AND project_id = ${projectId}::uuid
      RETURNING id
    `;
    if (deleted.length === 0) return false;
    await transaction`
      DELETE FROM shops shop
      WHERE shop.project_id = ${projectId}::uuid
        AND NOT EXISTS (SELECT 1 FROM session_shops link WHERE link.shop_id = shop.id)
    `;
    return true;
  });
}
