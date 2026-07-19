import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  getServerEnvironment: vi.fn(() => ({ TAVILY_API_KEY: "test-tavily-key" })),
}));

vi.mock("./db.server", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("./env.server", () => ({ getServerEnvironment: mocks.getServerEnvironment }));

import { discoverRepairShops } from "./tavily.server";

describe("Tavily request privacy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const transaction = Object.assign(vi.fn().mockResolvedValue([]), {
      json: vi.fn((value: unknown) => value),
    });
    const sql = Object.assign(vi.fn().mockResolvedValue([]), {
      begin: vi.fn(async (callback: (client: unknown) => Promise<unknown>) =>
        callback(transaction),
      ),
    });
    mocks.getDatabase.mockReturnValue(sql);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not send internal project or session identifiers to Tavily", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ request_id: "request-1", results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      discoverRepairShops(
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000002",
        "brake repair Charlotte",
      ),
    ).resolves.toEqual([]);

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(requestInit.headers);
    expect(headers.get("x-project-id")).toBeNull();
    expect(headers.get("x-session-id")).toBeNull();
  });
});
