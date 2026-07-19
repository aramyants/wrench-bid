import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  deleteStoredDocument: vi.fn(),
  deleteElevenLabsConversation: vi.fn(),
}));

vi.mock("./db.server", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("./document-extraction.server", () => ({
  buildRepairSpecFromText: vi.fn(),
  deleteStoredDocument: mocks.deleteStoredDocument,
}));
vi.mock("./elevenlabs.server", () => ({
  deleteElevenLabsConversation: mocks.deleteElevenLabsConversation,
}));

import { deleteRepairSession } from "./requests.server";

function createSqlMock(results: unknown[][]) {
  const statements: string[] = [];
  const query = vi.fn(async (strings: TemplateStringsArray) => {
    statements.push(strings.join("?"));
    return results.shift() ?? [];
  });
  const sql = Object.assign(query, {
    begin: vi.fn(async (callback: (transaction: unknown) => Promise<unknown>) => callback(sql)),
  });
  return { sql, statements };
}

async function rejectedResponse(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(Response);
    return error as Response;
  }
  throw new Error("Expected deletion to be deferred");
}

describe("repair-session deletion dispatch guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks deletion first and returns a retryable conflict while dispatch is in flight", async () => {
    const { sql, statements } = createSqlMock([[{ id: "session" }], [{ id: "call" }]]);
    mocks.getDatabase.mockReturnValue(sql);

    const response = await rejectedResponse(
      deleteRepairSession(
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000002",
      ),
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("retry-after")).toBe("2");
    expect(statements[0]).toContain("deletion_requested_at");
    expect(statements[1]).toContain("dispatch_started_at IS NOT NULL");
    expect(mocks.deleteElevenLabsConversation).not.toHaveBeenCalled();
    expect(mocks.deleteStoredDocument).not.toHaveBeenCalled();
  });

  it("cleans external resources only after every dispatch has finished", async () => {
    const { sql } = createSqlMock([
      [{ id: "session" }],
      [],
      [{ storage_key: "00000000-0000-4000-8000-000000000003.pdf" }],
      [{ provider_conversation_id: "conversation-1" }],
      [{ id: "session" }],
      [],
    ]);
    mocks.getDatabase.mockReturnValue(sql);

    await expect(
      deleteRepairSession(
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000002",
      ),
    ).resolves.toBe(true);

    expect(mocks.deleteElevenLabsConversation).toHaveBeenCalledWith("conversation-1");
    expect(mocks.deleteStoredDocument).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000003.pdf",
    );
  });

  it("does not touch external resources for an unknown session", async () => {
    const { sql } = createSqlMock([[]]);
    mocks.getDatabase.mockReturnValue(sql);

    await expect(
      deleteRepairSession(
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000002",
      ),
    ).resolves.toBe(false);

    expect(mocks.deleteElevenLabsConversation).not.toHaveBeenCalled();
    expect(mocks.deleteStoredDocument).not.toHaveBeenCalled();
  });
});
