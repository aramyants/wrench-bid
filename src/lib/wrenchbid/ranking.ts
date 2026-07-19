import type { Quote } from "./types";
import { AUTO_REPAIR_VERTICAL } from "./verticals/auto-repair";

export type RankedQuote = {
  quote: Quote;
  rank: number;
  benchmark: number | null;
  warnings: string[];
  rationale: string[];
};

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function rankQuotes(quotes: Quote[]): RankedQuote[] {
  const comparable = quotes.filter(
    (quote) =>
      quote.status === "complete" &&
      quote.total != null &&
      quote.completeness >= 0.9 &&
      quote.confirmedInCall,
  );
  const benchmark = median(comparable.map((quote) => quote.total as number));

  const scored = quotes.map((quote) => {
    const warnings = new Set(quote.warnings);
    const rationale: string[] = [];
    const total = quote.total;

    if (benchmark != null && total != null) {
      if (total < benchmark * AUTO_REPAIR_VERTICAL.benchmarks.suspiciousBelowRatio) {
        warnings.add("suspiciously_low");
      }
      if (total > benchmark * AUTO_REPAIR_VERTICAL.benchmarks.suspiciousAboveRatio) {
        warnings.add("suspiciously_high");
      }
    }

    if (quote.status !== "complete") warnings.add("incomplete_quote");
    if (total == null) warnings.add("missing_all_in_total");
    if (!quote.confirmedInCall) warnings.add("missing_total_transcript_evidence");
    if (quote.completeness < 0.9) warnings.add("non_comparable_scope");

    if (quote.completeness >= 0.9) rationale.push("Comparable, itemized scope");
    if (quote.confirmedInCall) rationale.push("Terms confirmed in the call");
    if (warnings.has("revised_after_negotiation"))
      rationale.push("Revised using verified competing-quote leverage");
    if (quote.warrantyDays) rationale.push(`${quote.warrantyDays}-day warranty`);
    if (quote.earliestDate) rationale.push(`Availability confirmed for ${quote.earliestDate}`);

    const warningPenalty =
      [...warnings].filter((warning) => warning !== "revised_after_negotiation").length * 100_000;
    const completenessPenalty = (1 - quote.completeness) * 50_000;
    const totalScore = total ?? Number.MAX_SAFE_INTEGER / 4;

    return {
      quote,
      benchmark,
      warnings: [...warnings],
      rationale,
      score: warningPenalty + completenessPenalty + totalScore,
    };
  });

  return scored
    .sort((a, b) => a.score - b.score)
    .map(({ score: _score, ...entry }, index) => ({ ...entry, rank: index + 1 }));
}
