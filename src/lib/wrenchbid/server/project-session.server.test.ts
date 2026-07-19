import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDatabase: vi.fn() }));

vi.mock("./db.server", () => ({ getDatabase: mocks.getDatabase }));

import { parseServerEnvironment } from "./env.server";
import { assertSameOrigin, requireExistingProjectSession } from "./project-session.server";

function rejectedResponse(callback: () => void) {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(Response);
    return error as Response;
  }
  throw new Error("Expected request to be rejected");
}

describe("mutation origin validation", () => {
  it("uses PUBLIC_APP_URL behind a production reverse proxy", () => {
    const environment = parseServerEnvironment({
      NODE_ENV: "production",
      PUBLIC_APP_URL: "https://wrenchbid.example/app",
    });
    const request = new Request("http://app:3000/api/requests", {
      headers: { origin: "https://wrenchbid.example" },
    });

    expect(() => assertSameOrigin(request, environment)).not.toThrow();
  });

  it("rejects an internal or hostile origin in production", () => {
    const environment = parseServerEnvironment({
      NODE_ENV: "production",
      PUBLIC_APP_URL: "https://wrenchbid.example",
    });

    for (const origin of ["http://app:3000", "https://attacker.example"]) {
      const response = rejectedResponse(() =>
        assertSameOrigin(
          new Request("http://app:3000/api/requests", { headers: { origin } }),
          environment,
        ),
      );
      expect(response.status).toBe(403);
    }
  });

  it("uses the request URL during local development", () => {
    const environment = parseServerEnvironment({
      NODE_ENV: "development",
      PUBLIC_APP_URL: "https://unused.example",
    });
    const request = new Request("http://localhost:3000/api/requests", {
      headers: { referer: "http://localhost:3000/requests/new" },
    });

    expect(() => assertSameOrigin(request, environment)).not.toThrow();
  });

  it("rejects production mutations without browser origin metadata", () => {
    const environment = parseServerEnvironment({ NODE_ENV: "production" });
    const response = rejectedResponse(() =>
      assertSameOrigin(new Request("http://app:3000/api/requests"), environment),
    );
    expect(response.status).toBe(403);
  });

  it("allows origin-less local development requests", () => {
    const environment = parseServerEnvironment({ NODE_ENV: "development" });
    expect(() =>
      assertSameOrigin(new Request("http://localhost:3000/api/requests"), environment),
    ).not.toThrow();
  });
});

describe("existing project sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a missing cookie without attempting anonymous project creation", async () => {
    await expect(
      requireExistingProjectSession(new Request("http://localhost:3000/api/requests/missing")),
    ).rejects.toMatchObject({ status: 401 });
    expect(mocks.getDatabase).not.toHaveBeenCalled();
  });

  it("rejects a malformed cookie without attempting a database lookup", async () => {
    await expect(
      requireExistingProjectSession(
        new Request("http://localhost:3000/api/requests/missing", {
          headers: { cookie: "wrenchbid_project=not-a-valid-project-session" },
        }),
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(mocks.getDatabase).not.toHaveBeenCalled();
  });

  it("rejects a stale well-formed cookie without inserting a replacement project", async () => {
    const query = vi.fn().mockResolvedValue([]);
    mocks.getDatabase.mockReturnValue(query);

    await expect(
      requireExistingProjectSession(
        new Request("http://localhost:3000/api/requests/missing", {
          headers: {
            cookie: "wrenchbid_project=00000000-0000-4000-8000-000000000001.stale-session-token",
          },
        }),
      ),
    ).rejects.toMatchObject({ status: 401 });

    expect(query).toHaveBeenCalledTimes(1);
    const statement = (query.mock.calls[0]?.[0] as TemplateStringsArray).join("?");
    expect(statement).toContain("SELECT id, access_token_hash");
    expect(statement).not.toContain("INSERT INTO projects");
  });
});
