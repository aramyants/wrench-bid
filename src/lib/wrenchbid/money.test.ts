import { describe, expect, it } from "vitest";
import { fromCents, subtractAmounts, sumAmounts, toCents } from "./money";

describe("deterministic money arithmetic", () => {
  it("sums classic float traps exactly", () => {
    expect(sumAmounts(0.1, 0.2)).toBe(0.3);
    expect(sumAmounts(312, 228, 0, 28, 0)).toBe(568);
    expect(sumAmounts(285, 204, 0, 45, 0)).toBe(534);
  });

  it("subtracts to exact cents where IEEE floats drift", () => {
    expect(616.69 - 585).not.toBe(31.69);
    expect(subtractAmounts(616.69, 585)).toBe(31.69);
    expect(subtractAmounts(613.44, 574)).toBe(39.44);
  });

  it("treats missing values as absent, never as zero dollars silently", () => {
    expect(sumAmounts(undefined, null)).toBe(0);
    expect(sumAmounts(10.05, undefined, 0.05)).toBe(10.1);
  });

  it("round-trips cents", () => {
    expect(toCents(48.69)).toBe(4869);
    expect(fromCents(4869)).toBe(48.69);
  });
});
