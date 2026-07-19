import { describe, expect, it } from "vitest";
import { readElevenLabsWebhookBody } from "./elevenlabs-webhook.server";

async function rejectedResponse(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(Response);
    return error as Response;
  }
  throw new Error("Expected request body to be rejected");
}

describe("ElevenLabs webhook body limits", () => {
  it("rejects an oversized declared body before reading it", async () => {
    let bodyRead = false;
    const request = {
      headers: new Headers({ "content-length": "5" }),
      body: {
        getReader() {
          bodyRead = true;
          throw new Error("The oversized body should not be read");
        },
      },
    } as unknown as Request;

    const response = await rejectedResponse(readElevenLabsWebhookBody(request, 4));

    expect(response.status).toBe(413);
    expect(bodyRead).toBe(false);
  });

  it("enforces the byte limit while streaming when Content-Length underreports", async () => {
    const request = new Request("http://localhost/api/webhooks/elevenlabs", {
      method: "POST",
      headers: { "content-length": "2" },
      body: "12345",
    });

    const response = await rejectedResponse(readElevenLabsWebhookBody(request, 4));

    expect(response.status).toBe(413);
  });

  it("returns an in-limit body without changing the signed text", async () => {
    const rawBody = '{"type":"post_call_transcription"}';
    const request = new Request("http://localhost/api/webhooks/elevenlabs", {
      method: "POST",
      body: rawBody,
    });

    await expect(readElevenLabsWebhookBody(request, 128)).resolves.toBe(rawBody);
  });

  it("rejects a malformed Content-Length header", async () => {
    const request = new Request("http://localhost/api/webhooks/elevenlabs", {
      method: "POST",
      headers: { "content-length": "unknown" },
      body: "{}",
    });

    const response = await rejectedResponse(readElevenLabsWebhookBody(request, 128));

    expect(response.status).toBe(400);
  });
});
