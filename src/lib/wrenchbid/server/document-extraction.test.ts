import { describe, expect, it } from "vitest";
import { buildRepairSpecFromText } from "./document-extraction.server";

describe("auto-repair PDF text extraction", () => {
  it("builds a reviewable draft while preserving evidence status", () => {
    const spec = buildRepairSpecFromText(
      "fd2b614d-834f-4487-80c9-cbe6b83ef211",
      `Estimate 2020 Toyota Camry SE
       VIN: 4T1G11AK5LU123456
       Odometer: 62,000
       Replace front brake pads and rotors.
       Charlotte, NC 28202`,
      "estimate.pdf",
    );

    expect(spec.vehicle).toMatchObject({
      year: 2020,
      make: "Toyota",
      model: "Camry",
      trim: "SE",
      mileage: 62000,
      vinLast8: "LU123456",
    });
    expect(spec.operations[0]?.description).toContain("Replace front brake pads");
    expect(spec.fieldMeta["vehicle.mileage"].status).toBe("needs_confirmation");
    expect(spec.status).toBe("draft");
  });

  it("marks absent fields as missing instead of inventing values", () => {
    const spec = buildRepairSpecFromText(
      "fd2b614d-834f-4487-80c9-cbe6b83ef211",
      "Customer supplied a short written estimate with no vehicle identifiers.",
      "unknown.pdf",
    );
    expect(spec.vehicle.make).toBe("");
    expect(spec.fieldMeta["vehicle.make"].status).toBe("missing");
    expect(spec.operations).toEqual([]);
  });
});
