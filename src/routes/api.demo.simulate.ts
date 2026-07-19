import { Buffer } from "node:buffer";
import { createFileRoute } from "@tanstack/react-router";
import { apiHandler } from "@/lib/wrenchbid/server/api.server";
import { withoutSpeechAnnotations } from "@/lib/wrenchbid/speech";
import {
  streamElevenLabsRepairSimulation,
  synthesizeElevenLabsSpeech,
} from "@/lib/wrenchbid/server/elevenlabs.server";
import { assertSameOrigin } from "@/lib/wrenchbid/server/project-session.server";
import { findRepairShopSource, type RepairShopSource } from "@/lib/wrenchbid/server/tavily.server";

const BUYER_VOICE_ID = "cjVigY5qzO86Huf0OWal";
const SHOP_VOICE_ID = "iP95p4xoKVk53GoZ742B";
const OPENING_MESSAGE =
  "Hi, this is WrenchBid, an AI assistant calling for a customer. May I get an itemized quote for a confirmed repair scope?";
const recentRuns: number[] = [];
let sourceCache: { value: RepairShopSource; expiresAt: number } | undefined;

type ProviderTurn = { role?: unknown; message?: unknown };
type ProviderEvent = { simulated_conversation?: ProviderTurn[] };

function checkRateLimit() {
  const cutoff = Date.now() - 5 * 60_000;
  while (recentRuns.length && recentRuns[0] < cutoff) recentRuns.shift();
  if (recentRuns.length >= 3) {
    throw new Response("The simulation limit was reached; try again in a few minutes", {
      status: 429,
    });
  }
  recentRuns.push(Date.now());
}

async function getSource() {
  if (sourceCache && sourceCache.expiresAt > Date.now()) return sourceCache.value;
  const value = await findRepairShopSource();
  sourceCache = { value, expiresAt: Date.now() + 15 * 60_000 };
  return value;
}

function extractJsonStringFrames(buffer: string) {
  const frames: string[] = [];
  let cursor = 0;
  while (cursor < buffer.length) {
    while (/\s/.test(buffer[cursor] ?? "")) cursor += 1;
    if (cursor >= buffer.length || buffer[cursor] !== '"') break;
    const start = cursor;
    cursor += 1;
    let escaped = false;
    let complete = false;
    for (; cursor < buffer.length; cursor += 1) {
      const character = buffer[cursor];
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        const encoded = buffer.slice(start, cursor + 1);
        frames.push(JSON.parse(encoded) as string);
        cursor += 1;
        complete = true;
        break;
      }
    }
    if (!complete) return { frames, remainder: buffer.slice(start) };
  }
  return { frames, remainder: buffer.slice(cursor) };
}

export const Route = createFileRoute("/api/demo/simulate")({
  server: {
    handlers: {
      POST: ({ request }) =>
        apiHandler(async () => {
          assertSameOrigin(request);
          checkRateLimit();
          const encoder = new TextEncoder();
          let cancelled = false;
          request.signal.addEventListener("abort", () => {
            cancelled = true;
          });
          const stream = new ReadableStream<Uint8Array>({
            async start(controller) {
              const send = (event: Record<string, unknown>) => {
                if (!cancelled) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
              };
              try {
                const source = await getSource();
                send({ type: "source", source });
                const providerPromise = streamElevenLabsRepairSimulation(source);
                const openingAudio = await synthesizeElevenLabsSpeech(
                  OPENING_MESSAGE,
                  BUYER_VOICE_ID,
                );
                const openingBytes = Buffer.from(await openingAudio.arrayBuffer());
                send({
                  type: "turn",
                  turn: {
                    id: "live-simulation-0",
                    speaker: "wrenchbid",
                    text: OPENING_MESSAGE,
                  },
                  audioDataUrl: `data:${openingAudio.headers.get("content-type") ?? "audio/mpeg"};base64,${openingBytes.toString("base64")}`,
                });
                const provider = await providerPromise;
                if (!provider.ok || !provider.body) {
                  throw new Error(`ElevenLabs simulation failed (${provider.status})`);
                }
                const reader = provider.body.getReader();
                const decoder = new TextDecoder();
                const seen = new Set<string>([`agent:${OPENING_MESSAGE}`]);
                let buffer = "";
                let turnCount = 1;
                let ended = false;
                while (!cancelled && !ended) {
                  const { done, value } = await reader.read();
                  buffer += decoder.decode(value, { stream: !done });
                  const extracted = extractJsonStringFrames(buffer);
                  buffer = extracted.remainder;
                  for (const frame of extracted.frames) {
                    const event = JSON.parse(frame) as ProviderEvent;
                    for (const item of event.simulated_conversation ?? []) {
                      if (item.role !== "agent" && item.role !== "user") continue;
                      if (typeof item.message !== "string") continue;
                      const text = withoutSpeechAnnotations(item.message);
                      if (!text) continue;
                      if (text.includes("END_CALL")) {
                        ended = true;
                        break;
                      }
                      const key = `${item.role}:${text}`;
                      if (seen.has(key)) continue;
                      seen.add(key);
                      const speaker = item.role === "agent" ? "wrenchbid" : "counter";
                      const audio = await synthesizeElevenLabsSpeech(
                        text,
                        speaker === "wrenchbid" ? BUYER_VOICE_ID : SHOP_VOICE_ID,
                      );
                      const audioBytes = Buffer.from(await audio.arrayBuffer());
                      send({
                        type: "turn",
                        turn: { id: `live-simulation-${turnCount}`, speaker, text },
                        audioDataUrl: `data:${audio.headers.get("content-type") ?? "audio/mpeg"};base64,${audioBytes.toString("base64")}`,
                      });
                      turnCount += 1;
                      if (turnCount >= 10) {
                        ended = true;
                        break;
                      }
                    }
                    if (ended) break;
                  }
                  if (done) break;
                }
                await reader.cancel().catch(() => undefined);
                send({ type: "complete", turnCount });
              } catch (error) {
                send({
                  type: "error",
                  message: error instanceof Error ? error.message : "The live simulation failed",
                });
              } finally {
                if (!cancelled) controller.close();
              }
            },
          });
          return new Response(stream, {
            headers: {
              "content-type": "application/x-ndjson; charset=utf-8",
              "cache-control": "private, no-store, no-transform",
              "x-accel-buffering": "no",
            },
          });
        }),
    },
  },
});
