import { randomUUID } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { E164_PHONE_PATTERN } from "@/lib/wrenchbid/phone";
import { ShopSchema } from "@/lib/wrenchbid/types";
import { apiHandler } from "@/lib/wrenchbid/server/api.server";
import { getDatabase } from "@/lib/wrenchbid/server/db.server";
import {
  assertSameOrigin,
  jsonResponse,
  requireProjectSession,
} from "@/lib/wrenchbid/server/project-session.server";

const E164PhoneSchema = z
  .string()
  .regex(E164_PHONE_PATTERN, "Use an E.164 phone number such as +17045551234");

const ManualShopSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: E164PhoneSchema,
  address: z.string().trim().min(5).max(250),
  website: z.union([z.string().url().max(500), z.literal("")]).optional(),
  phoneVerificationAttested: z.literal(true),
});

const VerifyShopPhoneSchema = z.object({
  shopId: z.string().uuid(),
  phone: E164PhoneSchema,
  phoneVerificationAttested: z.literal(true),
});

function serializeShop(row: Record<string, unknown>) {
  return ShopSchema.parse({
    id: row.id,
    name: row.name,
    phone: row.phone ?? "",
    phoneVerified: row.phone_verified,
    address: row.address ?? "",
    website: row.website ?? undefined,
    hours: row.hours ?? undefined,
    discoverySource: row.discovery_source,
  });
}

export const Route = createFileRoute("/api/requests/$id/shops")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        apiHandler(async () => {
          assertSameOrigin(request);
          const project = await requireProjectSession(request);
          const input = ManualShopSchema.parse(await request.json());
          const sql = getDatabase();
          const shop = await sql.begin(async (transaction) => {
            const [ownedRequest] = await transaction<
              Array<{ id: string; spec_status: "draft" | "confirmed" }>
            >`
              SELECT session.id, latest_spec.status AS spec_status
              FROM repair_sessions session
              JOIN LATERAL (
                SELECT spec.status
                FROM repair_specs spec
                WHERE spec.session_id = session.id
                ORDER BY spec.version DESC
                LIMIT 1
              ) latest_spec ON true
              WHERE session.id = ${params.id}::uuid
                AND session.project_id = ${project.projectId}::uuid
                AND session.deleted_at IS NULL
              LIMIT 1
            `;
            if (!ownedRequest) throw new Response("Request not found", { status: 404 });
            if (ownedRequest.spec_status !== "confirmed") {
              throw new Response("Confirm the RepairSpec before adding shops", { status: 409 });
            }

            await transaction`
              SELECT pg_advisory_xact_lock(hashtext(${`${project.projectId}:${input.phone}`}))
            `;
            const [existing] = await transaction<Array<Record<string, unknown>>>`
              SELECT
                id, name, phone, phone_verified, address, website, hours, discovery_source
              FROM shops
              WHERE project_id = ${project.projectId}::uuid AND phone = ${input.phone}
              LIMIT 1
              FOR UPDATE
            `;

            let row: Record<string, unknown>;
            if (existing) {
              [row] = await transaction<Array<Record<string, unknown>>>`
                UPDATE shops
                SET
                  name = ${input.name},
                  address = ${input.address},
                  website = ${input.website || null},
                  phone_verified = true,
                  phone_verified_at = now(),
                  phone_verification_method = 'user_attestation'
                WHERE id = ${existing.id as string}::uuid
                  AND project_id = ${project.projectId}::uuid
                RETURNING
                  id, name, phone, phone_verified, address, website, hours, discovery_source
              `;
            } else {
              [row] = await transaction<Array<Record<string, unknown>>>`
                INSERT INTO shops (
                  id,
                  project_id,
                  name,
                  phone,
                  phone_verified,
                  phone_verified_at,
                  phone_verification_method,
                  address,
                  website,
                  discovery_source
                ) VALUES (
                  ${randomUUID()}::uuid,
                  ${project.projectId}::uuid,
                  ${input.name},
                  ${input.phone},
                  true,
                  now(),
                  'user_attestation',
                  ${input.address},
                  ${input.website || null},
                  'manual'
                )
                RETURNING
                  id, name, phone, phone_verified, address, website, hours, discovery_source
              `;
            }

            const [link] = await transaction`
              INSERT INTO session_shops (session_id, shop_id)
              SELECT session.id, shop.id
              FROM repair_sessions session
              JOIN shops shop ON shop.id = ${row.id as string}::uuid
              WHERE session.id = ${params.id}::uuid
                AND session.project_id = ${project.projectId}::uuid
                AND session.deleted_at IS NULL
                AND shop.project_id = ${project.projectId}::uuid
              ON CONFLICT (session_id, shop_id) DO NOTHING
              RETURNING shop_id
            `;
            if (!link) {
              const [ownedLink] = await transaction`
                SELECT 1
                FROM session_shops selection
                JOIN repair_sessions session ON session.id = selection.session_id
                JOIN shops linked_shop ON linked_shop.id = selection.shop_id
                WHERE selection.session_id = ${params.id}::uuid
                  AND selection.shop_id = ${row.id as string}::uuid
                  AND session.project_id = ${project.projectId}::uuid
                  AND session.deleted_at IS NULL
                  AND linked_shop.project_id = ${project.projectId}::uuid
                LIMIT 1
              `;
              if (!ownedLink) {
                throw new Response("Request or shop ownership changed", { status: 403 });
              }
            }

            await transaction`
              INSERT INTO audit_events (
                id, project_id, session_id, event_type, message, metadata
              ) VALUES (
                ${randomUUID()}::uuid,
                ${project.projectId}::uuid,
                ${params.id}::uuid,
                'shop_phone_verified',
                'Shop phone explicitly verified by user attestation',
                ${transaction.json({
                  shopId: row.id as string,
                  method: "user_attestation",
                  origin: "manual_entry",
                })}
              )
            `;
            return serializeShop(row);
          });
          return jsonResponse({ shop }, { status: 201, setCookie: project.setCookie });
        }),
      PATCH: ({ request, params }) =>
        apiHandler(async () => {
          assertSameOrigin(request);
          const project = await requireProjectSession(request);
          const input = VerifyShopPhoneSchema.parse(await request.json());
          const sql = getDatabase();
          const shop = await sql.begin(async (transaction) => {
            const [ownedShop] = await transaction<Array<{ id: string }>>`
              SELECT shop.id
              FROM shops shop
              JOIN session_shops selection ON selection.shop_id = shop.id
              JOIN repair_sessions session ON session.id = selection.session_id
              JOIN LATERAL (
                SELECT spec.status
                FROM repair_specs spec
                WHERE spec.session_id = session.id
                ORDER BY spec.version DESC
                LIMIT 1
              ) latest_spec ON true
              WHERE session.id = ${params.id}::uuid
                AND session.project_id = ${project.projectId}::uuid
                AND session.deleted_at IS NULL
                AND latest_spec.status = 'confirmed'
                AND shop.id = ${input.shopId}::uuid
                AND shop.project_id = ${project.projectId}::uuid
              LIMIT 1
              FOR UPDATE OF shop
            `;
            if (!ownedShop) throw new Response("Shop not found for this request", { status: 404 });

            await transaction`
              SELECT pg_advisory_xact_lock(hashtext(${`${project.projectId}:${input.phone}`}))
            `;
            const [duplicate] = await transaction<Array<{ id: string }>>`
              SELECT id
              FROM shops
              WHERE project_id = ${project.projectId}::uuid
                AND phone = ${input.phone}
                AND id <> ${input.shopId}::uuid
              LIMIT 1
              FOR UPDATE
            `;
            if (duplicate) {
              throw new Response("That phone number belongs to another saved shop", {
                status: 409,
              });
            }

            const [row] = await transaction<Array<Record<string, unknown>>>`
              UPDATE shops
              SET
                phone = ${input.phone},
                phone_verified = true,
                phone_verified_at = now(),
                phone_verification_method = 'user_attestation'
              WHERE id = ${input.shopId}::uuid
                AND project_id = ${project.projectId}::uuid
              RETURNING
                id, name, phone, phone_verified, address, website, hours, discovery_source
            `;
            if (!row) throw new Response("Shop not found", { status: 404 });

            await transaction`
              INSERT INTO audit_events (
                id, project_id, session_id, event_type, message, metadata
              ) VALUES (
                ${randomUUID()}::uuid,
                ${project.projectId}::uuid,
                ${params.id}::uuid,
                'shop_phone_verified',
                'Discovered shop phone explicitly verified by user attestation',
                ${transaction.json({
                  shopId: row.id as string,
                  method: "user_attestation",
                  origin: "discovered_shop",
                })}
              )
            `;
            return serializeShop(row);
          });
          return jsonResponse({ shop }, { setCookie: project.setCookie });
        }),
    },
  },
});
