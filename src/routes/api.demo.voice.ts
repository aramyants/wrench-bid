import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  buildNegotiationConversation,
  buildQuoteConversation,
  DEMO_COUNTER_AGENTS,
} from "@/lib/wrenchbid/counter-agents";
import { apiHandler } from "@/lib/wrenchbid/server/api.server";
import {
  synthesizeElevenLabsDialogue,
  synthesizeElevenLabsSpeech,
} from "@/lib/wrenchbid/server/elevenlabs.server";
import { assertSameOrigin } from "@/lib/wrenchbid/server/project-session.server";

const RequestSchema = z.object({
  scenario: z.enum(["budget", "precision", "queencity", "negotiation"]),
  turnIndex: z.number().int().nonnegative().optional(),
});

const BUYER_VOICE_ID = "cjVigY5qzO86Huf0OWal";
const SHOP_VOICE_ID = "iP95p4xoKVk53GoZ742B";
const MAX_VOICE_TURNS_PER_MINUTE = 36;
const rateLimit = new Map<string, number[]>();

function checkRateLimit(request: Request) {
  const client = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || "local";
  const cutoff = Date.now() - 60_000;
  const recent = (rateLimit.get(client) ?? []).filter((time) => time > cutoff);
  if (recent.length >= MAX_VOICE_TURNS_PER_MINUTE) {
    throw new Response("Too many voice previews; try again shortly", { status: 429 });
  }
  recent.push(Date.now());
  rateLimit.set(client, recent);
}

function scenarioTurns(scenario: z.infer<typeof RequestSchema>["scenario"]) {
  if (scenario === "negotiation") {
    const precision = DEMO_COUNTER_AGENTS.find((agent) => agent.id === "precision")!;
    return buildNegotiationConversation({
      target: precision,
      leverageQuoteId: "q_budget",
      leverageShopName: "Budget Brake Center",
      leverageTotal: 574,
      leverageVerified: true,
      asks: ["beat_or_match", "waive_shop_supply"],
    }).turns;
  }
  const agent = DEMO_COUNTER_AGENTS.find((candidate) => candidate.id === scenario);
  if (!agent) throw new Response("Unknown arena scenario", { status: 404 });
  return buildQuoteConversation(agent);
}

export const Route = createFileRoute("/api/demo/voice")({
  server: {
    handlers: {
      POST: ({ request }) =>
        apiHandler(async () => {
          assertSameOrigin(request);
          checkRateLimit(request);
          const { scenario, turnIndex } = RequestSchema.parse(await request.json());
          const turns = scenarioTurns(scenario);
          if (turnIndex !== undefined) {
            const turn = turns[turnIndex];
            if (!turn) throw new Response("Unknown arena turn", { status: 404 });
            const audio = await synthesizeElevenLabsSpeech(
              turn.text,
              turn.speaker === "wrenchbid" ? BUYER_VOICE_ID : SHOP_VOICE_ID,
            );
            return new Response(audio.body, {
              status: 200,
              headers: {
                "content-type": audio.headers.get("content-type") ?? "audio/mpeg",
                "cache-control": "private, no-store",
              },
            });
          }
          const audio = await synthesizeElevenLabsDialogue(
            turns.map((turn) => ({
              text: turn.text,
              voiceId: turn.speaker === "wrenchbid" ? BUYER_VOICE_ID : SHOP_VOICE_ID,
            })),
          );
          return new Response(audio.body, {
            status: 200,
            headers: {
              "content-type": audio.headers.get("content-type") ?? "audio/mpeg",
              "cache-control": "private, no-store",
            },
          });
        }),
    },
  },
});
