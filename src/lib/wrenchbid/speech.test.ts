import { describe, expect, it } from "vitest";
import { numberToWords, speakableText } from "./speech";

describe("speakable money and number verbalization", () => {
  it("expands decimal amounts that TTS models slur", () => {
    expect(speakableText("$69.35")).toBe("sixty-nine dollars and thirty-five cents");
    expect(speakableText("All-in $616.69, warranty 12 months")).toBe(
      "All-in six hundred sixteen dollars and sixty-nine cents, warranty 12 months",
    );
    expect(speakableText("tax $48.69")).toBe("tax forty-eight dollars and sixty-nine cents");
  });

  it("drops zero cents and keeps whole-dollar amounts natural", () => {
    expect(speakableText("$574.00 all-in")).toBe("five hundred seventy-four dollars all-in");
    expect(speakableText("$45")).toBe("forty-five dollars");
    expect(speakableText("$1")).toBe("one dollar");
  });

  it("handles thousands, single-decimal, and cent-only amounts", () => {
    expect(speakableText("$1,234.56")).toBe(
      "one thousand two hundred thirty-four dollars and fifty-six cents",
    );
    expect(speakableText("$5.5")).toBe("five dollars and fifty cents");
    expect(speakableText("$0.99")).toBe("ninety-nine cents");
    expect(speakableText("$0.01")).toBe("one cent");
  });

  it("expands comma-grouped bare numbers like mileage", () => {
    expect(speakableText("62,000 miles")).toBe("sixty-two thousand miles");
    expect(speakableText("12,000 miles")).toBe("twelve thousand miles");
  });

  it("leaves plain text, small integers, and years untouched", () => {
    expect(speakableText("quote holds for 14 days")).toBe("quote holds for 14 days");
    expect(speakableText("2020 Toyota Camry SE")).toBe("2020 Toyota Camry SE");
    expect(speakableText("no numbers here")).toBe("no numbers here");
  });

  it("keeps out-of-range values in their original form", () => {
    expect(speakableText("$1,000,000")).toBe("$1,000,000");
    expect(numberToWords(1_000_000)).toBe("1000000");
  });
});
