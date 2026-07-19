import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { DEMO_INTAKE_TURNS } from "@/lib/wrenchbid/demo-intake";
import { apiHandler } from "@/lib/wrenchbid/server/api.server";
import { synthesizeElevenLabsSpeech } from "@/lib/wrenchbid/server/elevenlabs.server";
import { assertSameOrigin } from "@/lib/wrenchbid/server/project-session.server";

const RequestSchema = z
  .object({
    turnIndex: z
      .number()
      .int()
      .min(0)
      .max(DEMO_INTAKE_TURNS.length - 1),
  })
  .strict();

const INTAKE_AGENT_VOICE_ID = "cjVigY5qzO86Huf0OWal";
const CUSTOMER_VOICE_ID = "iP95p4xoKVk53GoZ742B";
const MAX_REQUESTS_PER_MINUTE = 24;
const rateLimit = new Map<string, number[]>();
const audioCache = new Map<number, Promise<{ bytes: ArrayBuffer; contentType: string }>>();

function checkRateLimit(request: Request) {
  const client = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || "local";
  const cutoff = Date.now() - 60_000;
  const recent = (rateLimit.get(client) ?? []).filter((time) => time > cutoff);
  if (recent.length >= MAX_REQUESTS_PER_MINUTE) {
    throw new Response("Too many intake voice requests; try again shortly", { status: 429 });
  }
  recent.push(Date.now());
  rateLimit.set(client, recent);
}

async function getTurnAudio(turnIndex: number) {
  const cached = audioCache.get(turnIndex);
  if (cached) return cached;

  const pending = (async () => {
    const turn = DEMO_INTAKE_TURNS[turnIndex];
    const response = await synthesizeElevenLabsSpeech(
      turn.text,
      turn.role === "agent" ? INTAKE_AGENT_VOICE_ID : CUSTOMER_VOICE_ID,
    );
    return {
      bytes: await response.arrayBuffer(),
      contentType: response.headers.get("content-type") ?? "audio/mpeg",
    };
  })();
  audioCache.set(turnIndex, pending);
  try {
    return await pending;
  } catch (error) {
    audioCache.delete(turnIndex);
    throw error;
  }
}

export const Route = createFileRoute("/api/demo/intake-voice")({
  server: {
    handlers: {
      POST: ({ request }) =>
        apiHandler(async () => {
          assertSameOrigin(request);
          checkRateLimit(request);
          const { turnIndex } = RequestSchema.parse(await request.json());
          const audio = await getTurnAudio(turnIndex);
          return new Response(audio.bytes.slice(0), {
            headers: {
              "content-type": audio.contentType,
              "cache-control": "private, no-store",
            },
          });
        }),
    },
  },
});
