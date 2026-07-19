import { describe, expect, it } from "vitest";
import {
  approvedNegotiationImprovements,
  validateGenuineLeverage,
  type NegotiationQuoteTerms,
} from "./negotiation-policy";

function terms(overrides: Partial<NegotiationQuoteTerms> = {}): NegotiationQuoteTerms {
  return {
    status: "complete",
    total: 700,
    currency: "USD",
    validUntil: "2030-12-31",
    completeness: 1,
    confirmedInCall: true,
    warnings: [],
    warrantyDays: 180,
    earliestDate: "2030-01-10",
    items: [
      { category: "diagnostic", amount: 50 },
      { category: "shop_supply", amount: 25 },
    ],
    ...overrides,
  };
}

describe("genuine negotiation leverage", () => {
  it("accepts only a lower, current, same-currency comparable quote", () => {
    expect(validateGenuineLeverage(terms(), terms({ total: 600 }), new Date("2030-01-01"))).toEqual(
      { ok: true, reasons: [] },
    );

    expect(
      validateGenuineLeverage(terms(), terms({ total: 701 }), new Date("2030-01-01")).reasons,
    ).toContain("leverage_not_lower");
    expect(
      validateGenuineLeverage(
        terms(),
        terms({ total: 600, currency: "CAD" }),
        new Date("2030-01-01"),
      ).reasons,
    ).toContain("currency_mismatch");
    expect(
      validateGenuineLeverage(
        terms(),
        terms({ total: 600, validUntil: "2029-12-31" }),
        new Date("2030-01-01"),
      ).reasons,
    ).toContain("leverage_expired");
  });

  it("rejects quote-integrity warnings even when the headline total is lower", () => {
    const result = validateGenuineLeverage(
      terms(),
      terms({ total: 1, warnings: ["quote_arithmetic_mismatch"] }),
      new Date("2030-01-01"),
    );
    expect(result).toEqual({ ok: false, reasons: ["quotes_not_comparable"] });
  });
});

describe("negotiation result validation", () => {
  it("credits only a measurable user-approved improvement", () => {
    const original = terms();
    const revised = terms({
      total: 700,
      warrantyDays: 365,
      items: [
        { category: "diagnostic", amount: 50 },
        { category: "shop_supply", amount: 25 },
      ],
    });
    expect(
      approvedNegotiationImprovements(original, revised, ["beat_or_match", "better_warranty"]),
    ).toEqual(["better_warranty"]);
  });

  it("does not label an unchanged quote as revised", () => {
    expect(
      approvedNegotiationImprovements(terms(), terms(), [
        "beat_or_match",
        "waive_diagnostic",
        "waive_shop_supply",
        "better_warranty",
        "earlier_appointment",
      ]),
    ).toEqual([]);
  });
});
