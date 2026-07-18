import { describe, expect, it } from "vitest";
import {
  findSupportingShopTurn,
  numericTokens,
  transcriptSupportsQuoteEvidence,
  type QuoteEvidenceCandidate,
} from "./quote-evidence";

const total = (value: number): QuoteEvidenceCandidate => ({
  fieldName: "all_in_total",
  kind: "money",
  value,
});

describe("quote transcript evidence", () => {
  it("parses a grouped amount as one full numeric token", () => {
    expect(numericTokens("The total is $1,600.00, including tax.")).toEqual([1600]);
  });

  it("does not confirm 600 from a 1,600 amount", () => {
    expect(transcriptSupportsQuoteEvidence("The total is $1,600.", total(600))).toBe(false);
  });

  it("matches equivalent money values at cent precision", () => {
    expect(transcriptSupportsQuoteEvidence("The total is $600.", total(600))).toBe(true);
    expect(transcriptSupportsQuoteEvidence("The total is $600.00.", total(600))).toBe(true);
    expect(transcriptSupportsQuoteEvidence("It comes to $616.69.", total(616.69))).toBe(true);
  });

  it("accepts evidence only from a shop turn", () => {
    const turns = [
      { speaker: "agent" as const, text: "Can you confirm the $600 total?", index: 0 },
      { speaker: "shop" as const, text: "Our total is $1,600.", index: 1 },
    ];
    expect(findSupportingShopTurn(turns, total(600))).toBeUndefined();

    turns[1].text = "Yes, our total is $600.";
    expect(findSupportingShopTurn(turns, total(600))?.index).toBe(1);
  });
});
