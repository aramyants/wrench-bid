import { describe, expect, it } from "vitest";
import { isVerifiedCallDestination } from "./phone";

describe("call destination verification", () => {
  it("accepts only an explicitly verified E.164 destination", () => {
    expect(isVerifiedCallDestination("+17045551234", true)).toBe(true);
    expect(isVerifiedCallDestination("+17045551234", false)).toBe(false);
    expect(isVerifiedCallDestination("704-555-1234", true)).toBe(false);
    expect(isVerifiedCallDestination(null, true)).toBe(false);
  });
});
