import { describe, expect, it } from "vitest";
import { parseServerEnvironment } from "./env.server";
import { assertSameOrigin } from "./project-session.server";

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

  it("allows requests without browser origin metadata", () => {
    const environment = parseServerEnvironment({ NODE_ENV: "production" });
    expect(() =>
      assertSameOrigin(new Request("http://app:3000/api/requests"), environment),
    ).not.toThrow();
  });
});
