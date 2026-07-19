import { toCents } from "./money";
import type { NegotiationAsk, Quote, QuoteItem } from "./types";

export type NegotiationQuoteTerms = Pick<
  Quote,
  | "status"
  | "total"
  | "currency"
  | "validUntil"
  | "completeness"
  | "confirmedInCall"
  | "warnings"
  | "warrantyDays"
  | "earliestDate"
> & { items: Array<Pick<QuoteItem, "category" | "amount">> };

const LEVERAGE_BLOCKING_WARNINGS = new Set([
  "currency_mismatch",
  "non_comparable_scope",
  "quote_arithmetic_mismatch",
  "missing_total_transcript_evidence",
]);

function hasBlockingWarning(warnings: string[]) {
  return warnings.some(
    (warning) => LEVERAGE_BLOCKING_WARNINGS.has(warning) || warning.startsWith("missing_"),
  );
}

function utcDate(value: string | undefined) {
  if (!value) return undefined;
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function validateGenuineLeverage(
  original: NegotiationQuoteTerms,
  leverage: NegotiationQuoteTerms,
  today = new Date(),
) {
  const reasons: string[] = [];
  if (
    original.status !== "complete" ||
    leverage.status !== "complete" ||
    original.total == null ||
    leverage.total == null ||
    original.completeness < 0.9 ||
    leverage.completeness < 0.9 ||
    !original.confirmedInCall ||
    !leverage.confirmedInCall ||
    hasBlockingWarning(original.warnings) ||
    hasBlockingWarning(leverage.warnings)
  ) {
    reasons.push("quotes_not_comparable");
  }
  if (original.currency !== leverage.currency) reasons.push("currency_mismatch");
  if (
    original.total != null &&
    leverage.total != null &&
    toCents(leverage.total) >= toCents(original.total)
  ) {
    reasons.push("leverage_not_lower");
  }
  const expiration = utcDate(leverage.validUntil);
  const todayUtc = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  if (!expiration || expiration < todayUtc) reasons.push("leverage_expired");
  return { ok: reasons.length === 0, reasons };
}

function itemAmount(quote: NegotiationQuoteTerms, category: QuoteItem["category"]) {
  return quote.items
    .filter((item) => item.category === category)
    .reduce((total, item) => total + toCents(item.amount), 0);
}

export function approvedNegotiationImprovements(
  original: NegotiationQuoteTerms,
  revised: NegotiationQuoteTerms,
  asks: readonly NegotiationAsk[],
) {
  const improvements: NegotiationAsk[] = [];
  for (const ask of asks) {
    if (
      ask === "beat_or_match" &&
      original.total != null &&
      revised.total != null &&
      toCents(revised.total) < toCents(original.total)
    ) {
      improvements.push(ask);
    } else if (
      ask === "waive_diagnostic" &&
      itemAmount(revised, "diagnostic") < itemAmount(original, "diagnostic")
    ) {
      improvements.push(ask);
    } else if (
      ask === "waive_shop_supply" &&
      itemAmount(revised, "shop_supply") < itemAmount(original, "shop_supply")
    ) {
      improvements.push(ask);
    } else if (
      ask === "better_warranty" &&
      (revised.warrantyDays ?? 0) > (original.warrantyDays ?? 0)
    ) {
      improvements.push(ask);
    } else if (ask === "earlier_appointment") {
      const before = utcDate(original.earliestDate);
      const after = utcDate(revised.earliestDate);
      if (before && after && after < before) improvements.push(ask);
    }
  }
  return improvements;
}
