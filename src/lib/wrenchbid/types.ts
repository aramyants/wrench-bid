import { z } from "zod";

export const VehicleSchema = z.object({
  year: z.number(),
  make: z.string(),
  model: z.string(),
  trim: z.string().optional(),
  mileage: z.number(),
  vinLast8: z.string(),
});
export type Vehicle = z.infer<typeof VehicleSchema>;

export const RepairOperationSchema = z.object({
  id: z.string(),
  description: z.string(),
  partsPreference: z
    .enum(["oem", "premium_aftermarket", "economy", "any"])
    .default("premium_aftermarket"),
  customerSuppliedParts: z.boolean().default(false),
});
export type RepairOperation = z.infer<typeof RepairOperationSchema>;

export const FieldSourceSchema = z.enum(["document", "voice", "manual", "seed"]);
export type FieldSource = z.infer<typeof FieldSourceSchema>;

export const FieldStatusSchema = z.enum([
  "verified",
  "needs_confirmation",
  "missing",
  "conflicting",
]);
export type FieldStatus = z.infer<typeof FieldStatusSchema>;

export const EvidenceMetaSchema = z.object({
  source: FieldSourceSchema,
  status: FieldStatusSchema,
  confidence: z.number().min(0).max(1),
  excerpt: z.string().optional(),
});
export type EvidenceMeta = z.infer<typeof EvidenceMetaSchema>;

export const RepairSpecSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  version: z.number(),
  status: z.enum(["draft", "confirmed"]),
  vehicle: VehicleSchema,
  diagnosisSource: z.string(),
  operations: z.array(RepairOperationSchema),
  location: z.object({ city: z.string(), region: z.string(), postal: z.string() }),
  completionByDays: z.number(),
  requiredQuoteFields: z.array(z.string()),
  fieldMeta: z.record(z.string(), EvidenceMetaSchema),
  specHash: z.string().optional(),
  confirmedAt: z.string().optional(),
  createdAt: z.string(),
});
export type RepairSpec = z.infer<typeof RepairSpecSchema>;

export const ShopSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  phoneVerified: z.boolean(),
  address: z.string(),
  website: z.string().optional(),
  hours: z.string().optional(),
  discoverySource: z.enum(["seed", "tavily", "manual"]),
  demoPolicy: z
    .object({
      label: z.string(),
      behaviorNotes: z.array(z.string()),
    })
    .optional(),
});
export type Shop = z.infer<typeof ShopSchema>;

export const CallStatusSchema = z.enum([
  "queued",
  "ringing",
  "connected",
  "collecting_quote",
  "waiting_callback",
  "completed",
  "declined",
  "no_answer",
  "failed",
]);
export type CallStatus = z.infer<typeof CallStatusSchema>;

export const EvidenceSpanSchema = z.object({
  id: z.string(),
  callId: z.string(),
  fieldName: z.string(),
  turnIndex: z.number(),
  speaker: z.enum(["agent", "shop", "customer"]),
  transcriptText: z.string(),
  timeSeconds: z.number(),
});
export type EvidenceSpan = z.infer<typeof EvidenceSpanSchema>;

export const TranscriptTurnSchema = z.object({
  index: z.number(),
  speaker: z.enum(["agent", "shop"]),
  text: z.string(),
  timeSeconds: z.number(),
});
export type TranscriptTurn = z.infer<typeof TranscriptTurnSchema>;

export const CallSchema = z.object({
  id: z.string(),
  campaignId: z.string(),
  shopId: z.string(),
  kind: z.enum(["quote", "negotiation"]).default("quote"),
  status: CallStatusSchema,
  phase: z.string(),
  currentObjective: z.string().optional(),
  durationSeconds: z.number().default(0),
  transcript: z.array(TranscriptTurnSchema),
  audioAvailable: z.boolean().default(false),
  audioUrl: z.string().optional(),
  providerConversationId: z.string().optional(),
  providerCallId: z.string().optional(),
  outcome: z.enum(["quote", "callback_commitment", "declined", "no_answer", "failed"]).optional(),
  failureReason: z.string().optional(),
  createdAt: z.string(),
});
export type Call = z.infer<typeof CallSchema>;

export const QuoteItemSchema = z.object({
  id: z.string(),
  category: z.enum(["parts", "labor", "diagnostic", "shop_supply", "disposal", "tax", "other"]),
  description: z.string(),
  amount: z.number(),
  included: z.boolean().default(true),
  partsGrade: z.string().optional(),
  disclosureNote: z.string().optional(),
});
export type QuoteItem = z.infer<typeof QuoteItemSchema>;

export const QuoteSchema = z.object({
  id: z.string(),
  callId: z.string(),
  shopId: z.string(),
  status: z.enum(["complete", "incomplete", "range_only", "declined"]),
  items: z.array(QuoteItemSchema),
  subtotal: z.number().optional(),
  tax: z.number().optional(),
  total: z.number().optional(),
  totalRange: z.tuple([z.number(), z.number()]).optional(),
  currency: z.string().default("USD"),
  warrantyText: z.string().optional(),
  warrantyDays: z.number().optional(),
  earliestDate: z.string().optional(),
  validUntil: z.string().optional(),
  completeness: z.number().min(0).max(1),
  conditions: z.array(z.string()),
  confirmedInCall: z.boolean().default(false),
  warnings: z.array(z.string()).default([]),
  createdAt: z.string(),
});
export type Quote = z.infer<typeof QuoteSchema>;

export const NegotiationAskSchema = z.enum([
  "beat_or_match",
  "waive_diagnostic",
  "waive_shop_supply",
  "better_warranty",
  "earlier_appointment",
]);
export type NegotiationAsk = z.infer<typeof NegotiationAskSchema>;

export const NegotiationSchema = z.object({
  id: z.string(),
  campaignId: z.string(),
  shopId: z.string(),
  originalQuoteId: z.string(),
  leverageQuoteId: z.string(),
  revisedQuoteId: z.string().optional(),
  asks: z.array(NegotiationAskSchema),
  approvedByUser: z.boolean(),
  outcome: z.enum(["pending", "approved", "revised", "rejected", "failed"]),
  createdAt: z.string(),
});
export type Negotiation = z.infer<typeof NegotiationSchema>;

export const CampaignSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  repairSpecId: z.string(),
  shopIds: z.array(z.string()),
  status: z.enum(["draft", "running", "completed", "failed"]),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  mode: z.enum(["live", "replay"]),
});
export type Campaign = z.infer<typeof CampaignSchema>;

export const AuditEventSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  eventType: z.string(),
  message: z.string(),
  metadata: z.record(z.string(), z.any()).optional(),
  createdAt: z.string(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const SessionSchema = z.object({
  id: z.string(),
  mode: z.enum(["demo", "live"]),
  status: z.enum([
    "draft",
    "extracted",
    "intake",
    "spec_confirmed",
    "shops_selected",
    "campaign_running",
    "completed",
    "deleted",
  ]),
  createdAt: z.string(),
});
export type Session = z.infer<typeof SessionSchema>;
