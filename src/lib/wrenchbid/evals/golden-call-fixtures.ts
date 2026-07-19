import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const TranscriptEntrySchema = z.object({
  role: z.enum(["agent", "user"]),
  message: z.string().min(1),
  time_in_call_secs: z.number(),
});

const ExpectedQuoteSchema = z.object({
  items: z.record(z.string(), z.number()),
  total: z.number(),
  subtotal: z.number().nullable(),
  status: z.enum(["complete", "incomplete"]),
  completeness: z.number().min(0).max(1),
  confirmedInCall: z.boolean(),
  warnings: z.array(z.string()),
  evidencedFields: z.array(z.string()),
});

const GoldenCallSchema = z.object({
  name: z.string().min(1),
  style: z.enum(["transparent", "hidden_fees", "evasive", "friction"]),
  description: z.string().min(1),
  data: z.object({
    conversation_id: z.string().min(1),
    status: z.string().min(1),
    transcript: z.array(TranscriptEntrySchema).min(1),
    analysis: z.object({
      data_collection_results: z.record(z.string(), z.unknown()),
    }),
    metadata: z.object({ call_duration_secs: z.number() }).optional(),
  }),
  expected: z.object({
    outcome: z.enum(["quote", "callback_commitment", "declined", "no_answer", "failed"]),
    quote: ExpectedQuoteSchema.nullable(),
    honesty: z.object({ aiDisclosureAsked: z.boolean() }),
  }),
});

export type GoldenCall = z.infer<typeof GoldenCallSchema>;

export function loadGoldenCalls(): GoldenCall[] {
  const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), "golden-calls");
  return readdirSync(fixtureDirectory)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) =>
      GoldenCallSchema.parse(JSON.parse(readFileSync(join(fixtureDirectory, file), "utf8"))),
    );
}
