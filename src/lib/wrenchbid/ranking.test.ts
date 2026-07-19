import { describe, expect, it } from "vitest";
import { median, rankQuotes } from "./ranking";
import type { Quote } from "./types";

function quote(id: string, total: number, overrides: Partial<Quote> = {}): Quote {
  return {
    id,
    callId: `call_${id}`,
    shopId: `shop_${id}`,
    status: "complete",
    items: [],
    total,
    currency: "USD",
    completeness: 1,
    conditions: [],
    confirmedInCall: true,
    warnings: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("quote ranking", () => {
  it("calculates a conventional median", () => {
    expect(median([30, 10, 20])).toBe(20);
    expect(median([10, 20])).toBe(15);
    expect(median([])).toBeNull();
  });

  it("flags totals more than 30 percent below the comparable median", () => {
    const ranked = rankQuotes([quote("low", 400), quote("mid", 700), quote("high", 800)]);
    const low = ranked.find((entry) => entry.quote.id === "low");
    expect(low?.benchmark).toBe(700);
    expect(low?.warnings).toContain("suspiciously_low");
  });

  it("does not recommend a cheaper incomplete quote over a complete quote", () => {
    const ranked = rankQuotes([
      quote("incomplete", 100, { status: "incomplete", completeness: 0.5 }),
      quote("complete", 600),
    ]);
    expect(ranked[0].quote.id).toBe("complete");
  });

  it("does not recommend or benchmark an unconfirmed transcript total", () => {
    const ranked = rankQuotes([
      quote("unconfirmed", 100, { confirmedInCall: false }),
      quote("confirmed", 600),
    ]);
    expect(ranked[0].quote.id).toBe("confirmed");
    expect(ranked[0].benchmark).toBe(600);
    expect(ranked[1].warnings).toContain("missing_total_transcript_evidence");
  });

  it("describes a negotiated revision without claiming it improved", () => {
    const [ranked] = rankQuotes([
      quote("revised", 700, { warnings: ["revised_after_negotiation"] }),
    ]);

    expect(ranked.rationale).toContain("Revised using verified competing-quote leverage");
    expect(ranked.rationale.join(" ")).not.toMatch(/improv/i);
  });
});
