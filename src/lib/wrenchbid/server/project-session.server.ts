import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { getDatabase } from "./db.server";
import { getServerEnvironment, type ServerEnvironment } from "./env.server";

const COOKIE_NAME = "wrenchbid_project";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ProjectSession = {
  projectId: string;
  setCookie?: string;
};

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function parseCookie(header: string | null, name: string) {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(value.join("="));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function equalHashes(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

async function findExistingProjectSession(request: Request): Promise<ProjectSession | undefined> {
  const cookie = parseCookie(request.headers.get("cookie"), COOKIE_NAME);
  if (cookie) {
    const separator = cookie.indexOf(".");
    if (separator > 0) {
      const projectId = cookie.slice(0, separator);
      const token = cookie.slice(separator + 1);
      if (UUID_PATTERN.test(projectId) && token) {
        const sql = getDatabase();
        const [project] = await sql<{ id: string; access_token_hash: string }[]>`
          SELECT id, access_token_hash
          FROM projects
          WHERE id = ${projectId}::uuid
          LIMIT 1
        `;
        if (project && equalHashes(project.access_token_hash, tokenHash(token))) {
          await sql`UPDATE projects SET last_access_at = now() WHERE id = ${projectId}::uuid`;
          return { projectId };
        }
      }
    }
  }

  return undefined;
}

export async function requireExistingProjectSession(request: Request): Promise<ProjectSession> {
  const project = await findExistingProjectSession(request);
  if (!project) throw new Response("Authentication required", { status: 401 });
  return project;
}

export async function requireProjectSession(request: Request): Promise<ProjectSession> {
  const existing = await findExistingProjectSession(request);
  if (existing) return existing;

  if (!getServerEnvironment().ALLOW_ANONYMOUS_PROJECTS) {
    throw new Response("Authentication required", { status: 401 });
  }

  const projectId = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const sql = getDatabase();
  await sql`
    INSERT INTO projects (id, access_token_hash)
    VALUES (${projectId}::uuid, ${tokenHash(token)})
  `;

  const secure = getServerEnvironment().NODE_ENV === "production" ? "; Secure" : "";
  return {
    projectId,
    setCookie: `${COOKIE_NAME}=${encodeURIComponent(`${projectId}.${token}`)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`,
  };
}

export function jsonResponse(
  data: unknown,
  options: { status?: number; setCookie?: string; headers?: HeadersInit } = {},
) {
  const headers = new Headers(options.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  if (options.setCookie) headers.append("set-cookie", options.setCookie);
  return new Response(JSON.stringify(data), { status: options.status ?? 200, headers });
}

export function assertSameOrigin(
  request: Request,
  environment: ServerEnvironment = getServerEnvironment(),
) {
  const source = request.headers.get("origin") ?? request.headers.get("referer");
  if (!source) {
    if (environment.NODE_ENV !== "production") return;
    throw new Response("Mutation origin is required", { status: 403 });
  }
  try {
    const expectedOrigin =
      environment.NODE_ENV === "production"
        ? new URL(environment.PUBLIC_APP_URL).origin
        : new URL(request.url).origin;
    if (new URL(source).origin === expectedOrigin) return;
  } catch {
    // Treat malformed Origin and Referer headers as cross-origin mutations.
  }
  throw new Response("Cross-origin mutation rejected", { status: 403 });
}
