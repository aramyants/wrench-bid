import { fromCents, toCents } from "./money";
import type { Quote } from "./types";
import { AUTO_REPAIR_VERTICAL } from "./verticals/auto-repair";

export type RankedQuote = {
  quote: Quote;
  rank: number;
  benchmark: number | null;
  eligible: boolean;
  ineligibilityReasons: string[];
  warnings: string[];
  rationale: string[];
};

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.map(toCents).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const cents =
    sorted.length % 2 === 0
      ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
      : sorted[middle];
  return fromCents(cents);
}

const BLOCKING_WARNING_NAMES = new Set([
  "incomplete_quote",
  "missing_all_in_total",
  "missing_total_transcript_evidence",
  "non_comparable_scope",
  "currency_mismatch",
  "quote_arithmetic_mismatch",
  "suspiciously_low",
]);

function isBlockingWarning(warning: string) {
  return BLOCKING_WARNING_NAMES.has(warning) || warning.startsWith("missing_");
}

function isBenchmarkComparable(quote: Quote) {
  return (
    quote.status === "complete" &&
    quote.total != null &&
    quote.completeness >= 0.9 &&
    quote.confirmedInCall &&
    quote.currency === "USD" &&
    !quote.warnings.some((warning) => isBlockingWarning(warning) && warning !== "suspiciously_low")
  );
}

export function rankQuotes(quotes: Quote[]): RankedQuote[] {
  const comparable = quotes.filter(isBenchmarkComparable);
  const benchmark =
    comparable.length >= AUTO_REPAIR_VERTICAL.benchmarks.minimumComparableQuotes
      ? median(comparable.map((quote) => quote.total as number))
      : null;

  const scored = quotes.map((quote) => {
    const warnings = new Set(quote.warnings);
    const rationale: string[] = [];
    const total = quote.total;

    if (quote.currency !== "USD") warnings.add("currency_mismatch");

    if (benchmark != null && total != null && quote.currency === "USD") {
      const totalCents = toCents(total);
      const benchmarkCents = toCents(benchmark);
      if (
        totalCents <=
        Math.round(benchmarkCents * AUTO_REPAIR_VERTICAL.benchmarks.suspiciousBelowRatio)
      ) {
        warnings.add("suspiciously_low");
      }
      if (
        totalCents >
        Math.round(benchmarkCents * AUTO_REPAIR_VERTICAL.benchmarks.suspiciousAboveRatio)
      ) {
        warnings.add("suspiciously_high");
      }
    }

    if (quote.status !== "complete") warnings.add("incomplete_quote");
    if (total == null) warnings.add("missing_all_in_total");
    if (!quote.confirmedInCall) warnings.add("missing_total_transcript_evidence");
    if (quote.completeness < 0.9) warnings.add("non_comparable_scope");

    if (quote.completeness >= 0.9) rationale.push("Comparable, itemized scope");
    if (quote.confirmedInCall) rationale.push("Monetary terms confirmed in the call");
    if (warnings.has("revised_after_negotiation")) rationale.push("Captured after negotiation");
    if (quote.warrantyDays) rationale.push(`${quote.warrantyDays}-day warranty`);
    if (quote.earliestDate) rationale.push(`Reported availability: ${quote.earliestDate}`);

    const ineligibilityReasons = [...warnings].filter(isBlockingWarning);
    const eligible = ineligibilityReasons.length === 0;

    return {
      quote,
      benchmark,
      eligible,
      ineligibilityReasons,
      warnings: [...warnings],
      rationale,
      riskCount: [...warnings].filter((warning) => warning !== "revised_after_negotiation").length,
    };
  });

  return scored
    .sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      if (a.riskCount !== b.riskCount) return a.riskCount - b.riskCount;
      if (a.quote.completeness !== b.quote.completeness)
        return b.quote.completeness - a.quote.completeness;
      return (
        toCents(a.quote.total ?? Number.MAX_SAFE_INTEGER / 100) -
        toCents(b.quote.total ?? Number.MAX_SAFE_INTEGER / 100)
      );
    })
    .map(({ riskCount: _riskCount, ...entry }, index) => ({ ...entry, rank: index + 1 }));
}
