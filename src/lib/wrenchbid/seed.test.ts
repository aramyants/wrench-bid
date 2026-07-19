import { describe, expect, it } from "vitest";
import { DEMO_REPAIR_SPEC_SUMMARY } from "./counter-agents";
import { seedSpec } from "./seed";

describe("demo RepairSpec fixture", () => {
  it("matches the confirmed mileage used by the arena", () => {
    expect(seedSpec.vehicle.mileage).toBe(62000);
    expect(seedSpec.fieldMeta["vehicle.mileage"]).toMatchObject({
      source: "manual",
      status: "verified",
    });
    expect(DEMO_REPAIR_SPEC_SUMMARY).toContain("62,000 miles");
  });
});
