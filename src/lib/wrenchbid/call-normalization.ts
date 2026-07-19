import { sumAmounts, toCents } from "./money";
import {
  findSupportingShopTurn,
  type QuoteEvidenceCandidate,
  type QuoteEvidenceKind,
} from "./quote-evidence";
import type { QuoteItem } from "./types";
import { AUTO_REPAIR_VERTICAL } from "./verticals/auto-repair";

export type NormalizedTurn = {
  index: number;
  speaker: "agent" | "shop";
  text: string;
  timeSeconds: number;
};

export type CallOutcome = "quote" | "callback_commitment" | "declined" | "no_answer" | "failed";

function unwrap(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  for (const key of ["value", "result", "data_collection_result"]) {
    if (record[key] !== undefined) return unwrap(record[key]);
  }
  return value;
}

export function extractDataCollection(data: Record<string, unknown>) {
  const analysis = (data.analysis ?? {}) as Record<string, unknown>;
  const raw = (analysis.data_collection_results ?? {}) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, unwrap(value)]));
}

export function namedValue(values: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (values[key] != null) return values[key];
  }
  return undefined;
}

export function moneyValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 1000) : undefined;
}

export function stringArray(value: unknown) {
  if (Array.isArray(value))
    return value.map(stringValue).filter((item): item is string => Boolean(item));
  const single = stringValue(value);
  return single ? [single] : [];
}

export function dateValue(value: unknown) {
  const text = stringValue(value);
  const match = text ? /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(text) : null;
  if (!match) return undefined;
  const normalized = `${match[1]}-${match[2]}-${match[3]}`;
  return Number.isNaN(new Date(`${normalized}T00:00:00.000Z`).getTime()) ? undefined : normalized;
}

export function normalizeTranscript(value: unknown): NormalizedTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((turn, index) => {
      if (!turn || typeof turn !== "object") return null;
      const record = turn as Record<string, unknown>;
      const text = stringValue(record.message ?? record.text);
      if (!text) return null;
      return {
        index,
        speaker: record.role === "agent" ? ("agent" as const) : ("shop" as const),
        text,
        timeSeconds: Number(record.time_in_call_secs ?? record.time_seconds ?? index * 5) || 0,
      };
    })
    .filter((turn): turn is NormalizedTurn => turn !== null);
}

export function inferOutcome(
  data: Record<string, unknown>,
  values: Record<string, unknown>,
  turns: NormalizedTurn[],
): CallOutcome {
  const explicit = stringValue(
    namedValue(values, "call_outcome", "outcome", "terminal_outcome"),
  )?.toLowerCase();
  if (explicit?.includes("callback")) return "callback_commitment";
  if (explicit?.includes("declin") || explicit?.includes("refus")) return "declined";
  if (explicit?.includes("no_answer") || explicit?.includes("no answer")) return "no_answer";
  if (explicit?.includes("fail")) return "failed";
  if (explicit?.includes("quote")) return "quote";

  const transcript = turns
    .map((turn) => turn.text)
    .join(" ")
    .toLowerCase();
  if (/call (you|the customer) back|callback/.test(transcript)) return "callback_commitment";
  if (/cannot provide|won't provide|decline/.test(transcript)) return "declined";
  if (moneyValue(namedValue(values, "all_in_total", "total", "quote_total")) != null)
    return "quote";
  const status = stringValue(data.status)?.toLowerCase();
  return status === "failed" ? "failed" : "declined";
}

export type NormalizedQuoteItem = {
  category: QuoteItem["category"];
  description: string;
  amount: number;
};

export type QuoteEvidenceMatch = {
  fieldName: string;
  turn: NormalizedTurn;
};

export type NormalizedQuote = {
  parts?: number;
  labor?: number;
  diagnostic?: number;
  shopSupply?: number;
  disposal?: number;
  tax?: number;
  total?: number;
  warrantyText?: string;
  warrantyDays?: number;
  earliestDate?: string;
  validUntil?: string;
  currency?: string;
  conditions: string[];
  subtotal: number | null;
  completeness: number;
  status: "complete" | "incomplete";
  confirmedInCall: boolean;
  items: NormalizedQuoteItem[];
  evidence: QuoteEvidenceMatch[];
  warnings: string[];
};

export function normalizeQuote(input: {
  values: Record<string, unknown>;
  turns: NormalizedTurn[];
  revised: boolean;
}): NormalizedQuote {
  const parts = moneyValue(namedValue(input.values, "parts", "parts_total"));
  const labor = moneyValue(namedValue(input.values, "labor", "labor_total"));
  const diagnostic = moneyValue(namedValue(input.values, "diagnostic_fee", "diagnostic"));
  const shopSupply = moneyValue(namedValue(input.values, "shop_supply_fee", "shop_supplies"));
  const disposal = moneyValue(namedValue(input.values, "disposal_fee", "disposal"));
  const tax = moneyValue(namedValue(input.values, "tax", "sales_tax"));
  const total = moneyValue(namedValue(input.values, "all_in_total", "total", "quote_total"));
  const warrantyText = stringValue(namedValue(input.values, "warranty", "warranty_text"));
  const warrantyDays = moneyValue(namedValue(input.values, "warranty_days"));
  const earliestDate = dateValue(namedValue(input.values, "earliest_appointment", "earliest_date"));
  const validUntil = dateValue(namedValue(input.values, "quote_expiration", "valid_until"));
  const conditions = stringArray(namedValue(input.values, "conditions", "quote_conditions"));
  const currencyText = stringValue(namedValue(input.values, "currency", "quote_currency"));
  const currency = currencyText ? /[A-Z]{3}/.exec(currencyText.toUpperCase())?.[0] : undefined;
  const present = [
    parts,
    labor,
    diagnostic,
    shopSupply,
    disposal,
    tax,
    total,
    warrantyText,
    earliestDate,
    validUntil,
    conditions.length ? conditions : undefined,
  ].filter((value) => value !== undefined).length;
  const completeness = present / AUTO_REPAIR_VERTICAL.requiredQuoteFields.length;
  const items: NormalizedQuoteItem[] = (
    [
      ["parts", "Parts", parts],
      ["labor", "Labor", labor],
      ["diagnostic", "Diagnostic fee", diagnostic],
      ["shop_supply", "Shop-supply fee", shopSupply],
      ["disposal", "Disposal fee", disposal],
      ["tax", "Tax", tax],
    ] as const
  ).flatMap(([category, description, amount]) =>
    amount == null ? [] : [{ category, description, amount }],
  );
  const rawEvidenceCandidates: Array<[string, QuoteEvidenceKind, string | number | undefined]> = [
    ["parts", "money", parts],
    ["labor", "money", labor],
    ["diagnostic_fee", "money", diagnostic],
    ["shop_supply_fee", "money", shopSupply],
    ["disposal_fee", "money", disposal],
    ["tax", "money", tax],
    ["all_in_total", "money", total],
    ["warranty", "text", warrantyText],
    ["warranty_days", "number", warrantyDays],
    ["earliest_appointment", "date", earliestDate],
    ["quote_expiration", "date", validUntil],
  ];
  const evidenceCandidates: QuoteEvidenceCandidate[] = rawEvidenceCandidates.flatMap(
    ([fieldName, kind, value]) => (value == null ? [] : [{ fieldName, kind, value }]),
  );
  for (const condition of conditions) {
    evidenceCandidates.push({ fieldName: "conditions", kind: "text", value: condition });
  }
  const evidence = evidenceCandidates.flatMap((candidate) => {
    const turn = findSupportingShopTurn(input.turns, candidate);
    return turn ? [{ fieldName: candidate.fieldName, turn }] : [];
  });
  const monetaryFields = [
    ["parts", parts],
    ["labor", labor],
    ["diagnostic_fee", diagnostic],
    ["shop_supply_fee", shopSupply],
    ["disposal_fee", disposal],
    ["tax", tax],
    ["all_in_total", total],
  ] as const;
  const capturedMonetaryFields = monetaryFields.filter(([, value]) => value != null);
  const evidencedFields = new Set(evidence.map((match) => match.fieldName));
  const totalConfirmedInTranscript = total != null && evidencedFields.has("all_in_total");
  const allMonetaryFieldsCaptured = capturedMonetaryFields.length === monetaryFields.length;
  const allMonetaryFieldsEvidenced =
    allMonetaryFieldsCaptured &&
    monetaryFields.every(([fieldName]) => evidencedFields.has(fieldName));
  const preTaxSubtotal =
    parts != null && labor != null && diagnostic != null && shopSupply != null && disposal != null
      ? sumAmounts(parts, labor, diagnostic, shopSupply, disposal)
      : null;
  const arithmeticMatches =
    preTaxSubtotal != null &&
    tax != null &&
    total != null &&
    toCents(total) === toCents(sumAmounts(preTaxSubtotal, tax));
  const safeComparableQuote =
    completeness >= 0.9 &&
    allMonetaryFieldsCaptured &&
    allMonetaryFieldsEvidenced &&
    arithmeticMatches;
  const warnings = [
    ...(input.revised ? ["revised_after_negotiation"] : []),
    ...(currency && currency !== "USD" ? ["currency_mismatch"] : []),
    ...monetaryFields.flatMap(([fieldName, value]) =>
      value == null ? [`missing_${fieldName}`] : [],
    ),
    ...monetaryFields.flatMap(([fieldName, value]) =>
      value != null && !evidencedFields.has(fieldName)
        ? [
            fieldName === "all_in_total"
              ? "missing_total_transcript_evidence"
              : `missing_${fieldName}_transcript_evidence`,
          ]
        : [],
    ),
    ...(allMonetaryFieldsCaptured && !arithmeticMatches ? ["quote_arithmetic_mismatch"] : []),
    ...(!safeComparableQuote ? ["non_comparable_scope"] : []),
  ];

  return {
    parts,
    labor,
    diagnostic,
    shopSupply,
    disposal,
    tax,
    total,
    warrantyText,
    warrantyDays,
    earliestDate,
    validUntil,
    currency,
    conditions,
    subtotal: preTaxSubtotal,
    completeness,
    status: safeComparableQuote ? "complete" : "incomplete",
    confirmedInCall: totalConfirmedInTranscript,
    items,
    evidence,
    warnings,
  };
}
