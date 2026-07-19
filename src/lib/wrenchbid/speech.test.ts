import { describe, expect, it } from "vitest";
import { numberToWords, speakableText, spokenText, withoutSpeechAnnotations } from "./speech";

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

  it("leaves plain text and small integers untouched", () => {
    expect(speakableText("quote holds for 14 days")).toBe("quote holds for 14 days");
    expect(speakableText("no numbers here")).toBe("no numbers here");
  });

  it("keeps out-of-range values in their original form", () => {
    expect(speakableText("$1,000,000")).toBe("$1,000,000");
    expect(numberToWords(1_000_000)).toBe("1000000");
  });

  it("speaks vehicle years and postal codes naturally", () => {
    expect(speakableText("2020 Toyota Camry; Charlotte, NC 28202")).toBe(
      "twenty twenty Toyota Camry; Charlotte, NC two eight two oh two",
    );
  });

  it("fully expands ungrouped four-digit money values", () => {
    expect(speakableText("The total is $1600.00.")).toBe(
      "The total is one thousand six hundred dollars.",
    );
  });

  it("makes the complete itemization unambiguous for TTS", () => {
    expect(
      spokenText(
        "[confident] Sure. Parts are $312.00. Labor is $228.00. Shop supplies are $28.00. There is no diagnostic fee. Tax is $48.69.",
      ),
    ).toBe(
      "Sure. Parts are three hundred twelve dollars. Labor is two hundred twenty-eight dollars. Shop supplies are twenty-eight dollars. There is no diagnostic fee. Tax is forty-eight dollars and sixty-nine cents.",
    );
  });
});

describe("speech annotations", () => {
  it("removes emotion and delivery cues from conversation text", () => {
    expect(withoutSpeechAnnotations("[happy] Thank you so much.")).toBe("Thank you so much.");
    expect(withoutSpeechAnnotations("[whispers] The total is $574. [laughs softly]")).toBe(
      "The total is $574.",
    );
  });

  it("preserves bracketed values that are not voice directions", () => {
    expect(withoutSpeechAnnotations("Warranty: [12 months] or 12,000 miles.")).toBe(
      "Warranty: [12 months] or 12,000 miles.",
    );
  });
});
