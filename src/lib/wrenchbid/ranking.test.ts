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
    expect(median([0.01, 0.02])).toBe(0.02);
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
    expect(ranked[0].benchmark).toBeNull();
    expect(ranked[1].warnings).toContain("missing_total_transcript_evidence");
    expect(ranked[0].eligible).toBe(true);
    expect(ranked[1].eligible).toBe(false);
  });

  it("describes a negotiated revision without claiming it improved", () => {
    const [ranked] = rankQuotes([
      quote("revised", 700, { warnings: ["revised_after_negotiation"] }),
    ]);

    expect(ranked.rationale).toContain("Captured after negotiation");
    expect(ranked.rationale.join(" ")).not.toMatch(/improv/i);
  });

  it("flags a quote exactly 30 percent below the benchmark", () => {
    const ranked = rankQuotes([quote("low", 490), quote("mid", 700), quote("high", 910)]);
    const low = ranked.find((entry) => entry.quote.id === "low");
    expect(low?.benchmark).toBe(700);
    expect(low?.warnings).toContain("suspiciously_low");
    expect(low?.eligible).toBe(false);
  });

  it("uses only eligible USD quotes for the benchmark", () => {
    const ranked = rankQuotes([
      quote("usd-low", 430),
      quote("usd-high", 700),
      quote("cad", 1000, { currency: "CAD", warnings: ["currency_mismatch"] }),
    ]);
    expect(ranked[0].benchmark).toBe(565);
    expect(ranked.find((entry) => entry.quote.id === "usd-low")?.warnings).not.toContain(
      "suspiciously_low",
    );
    expect(ranked.find((entry) => entry.quote.id === "cad")?.eligible).toBe(false);
    expect(ranked.at(-1)?.quote.id).toBe("cad");
  });

  it("never lets a suspicious lowball outrank safe quotes at large price scales", () => {
    const ranked = rankQuotes([
      quote("lowball", 1),
      quote("safe-a", 200_000),
      quote("safe-b", 220_000),
    ]);
    expect(ranked.find((entry) => entry.quote.id === "lowball")?.eligible).toBe(false);
    expect(ranked[0].quote.id).toBe("safe-a");
    expect(ranked.at(-1)?.quote.id).toBe("lowball");
  });

  it("requires the configured minimum sample before publishing a benchmark", () => {
    const [ranked] = rankQuotes([quote("only", 600)]);
    expect(ranked.benchmark).toBeNull();
  });

  it("keeps arithmetic-invalid quotes behind safe quotes", () => {
    const ranked = rankQuotes([
      quote("invalid", 100, { warnings: ["quote_arithmetic_mismatch"] }),
      quote("safe-a", 600),
      quote("safe-b", 650),
    ]);
    expect(ranked[0].quote.id).toBe("safe-a");
    expect(ranked.find((entry) => entry.quote.id === "invalid")?.eligible).toBe(false);
  });
});
