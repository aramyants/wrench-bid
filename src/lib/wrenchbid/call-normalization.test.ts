import { describe, expect, it } from "vitest";
import { moneyValue, normalizeQuote, type NormalizedTurn } from "./call-normalization";

const COMPLETE_VALUES: Record<string, unknown> = {
  parts: 100,
  labor: 80,
  diagnostic_fee: 0,
  shop_supply_fee: 10,
  disposal_fee: 0,
  tax: 10,
  all_in_total: 200,
  warranty: "12 months",
  earliest_appointment: "2026-07-20",
  quote_expiration: "2026-07-30",
};

const COMPLETE_TURNS: NormalizedTurn[] = [
  {
    index: 0,
    speaker: "shop",
    text: "Parts are $100, labor is $80, diagnostic and disposal are waived, shop supplies are $10, and tax is $10. The final all-in total is $200.",
    timeSeconds: 1,
  },
];

function normalize(
  values: Record<string, unknown> = COMPLETE_VALUES,
  turns: NormalizedTurn[] = COMPLETE_TURNS,
) {
  return normalizeQuote({ values, turns, revised: false });
}

describe("quote normalization safety invariants", () => {
  it("accepts a fully captured, evidenced, cent-reconciled quote", () => {
    const quote = normalize();
    expect(quote.status).toBe("complete");
    expect(quote.confirmedInCall).toBe(true);
    expect(quote.subtotal).toBe(190);
    expect(quote.warnings).toEqual([]);
  });

  it("rejects negative money instead of coercing it to zero", () => {
    expect(moneyValue(-5)).toBeUndefined();
    expect(moneyValue("-$5.00")).toBeUndefined();

    const quote = normalize({ ...COMPLETE_VALUES, diagnostic_fee: -5 });
    expect(quote.status).toBe("incomplete");
    expect(quote.items.some((item) => item.category === "diagnostic")).toBe(false);
    expect(quote.warnings).toContain("missing_diagnostic_fee");
  });

  it.each([
    ["parts", "missing_parts"],
    ["labor", "missing_labor"],
    ["diagnostic_fee", "missing_diagnostic_fee"],
    ["shop_supply_fee", "missing_shop_supply_fee"],
    ["disposal_fee", "missing_disposal_fee"],
    ["tax", "missing_tax"],
    ["all_in_total", "missing_all_in_total"],
  ])("keeps a quote incomplete when %s is absent", (fieldName, warning) => {
    const values = { ...COMPLETE_VALUES };
    delete values[fieldName];
    const quote = normalize(values);
    expect(quote.status).toBe("incomplete");
    expect(quote.confirmedInCall).toBe(fieldName !== "all_in_total");
    expect(quote.warnings).toContain(warning);
  });

  it("does not treat unspoken model-supplied zero fees as captured", () => {
    const quote = normalize(COMPLETE_VALUES, [
      {
        index: 0,
        speaker: "shop",
        text: "Parts are $100, labor is $80, shop supplies are $10, tax is $10, and the final all-in total is $200.",
        timeSeconds: 1,
      },
    ]);
    expect(quote.status).toBe("incomplete");
    expect(quote.confirmedInCall).toBe(true);
    expect(quote.warnings).toContain("missing_diagnostic_fee_transcript_evidence");
    expect(quote.warnings).toContain("missing_disposal_fee_transcript_evidence");
  });

  it("rejects totals that do not reconcile to line items plus tax", () => {
    const quote = normalize({ ...COMPLETE_VALUES, all_in_total: 199 });
    expect(quote.status).toBe("incomplete");
    expect(quote.confirmedInCall).toBe(false);
    expect(quote.warnings).toContain("quote_arithmetic_mismatch");
  });

  it("does not confirm a total from another field's matching amount", () => {
    const quote = normalize({ ...COMPLETE_VALUES, diagnostic_fee: 10, all_in_total: 10 }, [
      {
        index: 0,
        speaker: "shop",
        text: "Parts are $100, labor is $80, diagnostic is $10, shop supplies are $10, disposal is waived, tax is $10, and the final all-in total is $210.",
        timeSeconds: 1,
      },
    ]);
    expect(quote.status).toBe("incomplete");
    expect(quote.confirmedInCall).toBe(false);
    expect(quote.warnings).toContain("missing_total_transcript_evidence");
    expect(quote.warnings).toContain("quote_arithmetic_mismatch");
  });
});
