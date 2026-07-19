// Speech-side text normalization. Low-latency ElevenLabs models skip text
// normalization, so raw amounts like "$616.69" are voiced as mushy digit
// strings. Expanding money and large comma-grouped numbers into words before
// synthesis guarantees clarity on every model. Numeric display text stays
// exact; only the string sent to the TTS API is verbalized.

const ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];

const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function underHundred(value: number): string {
  if (value < 20) return ONES[value];
  const tens = TENS[Math.floor(value / 10)];
  const ones = value % 10;
  return ones === 0 ? tens : `${tens}-${ONES[ones]}`;
}

function underThousand(value: number): string {
  if (value < 100) return underHundred(value);
  const hundreds = `${ONES[Math.floor(value / 100)]} hundred`;
  const rest = value % 100;
  return rest === 0 ? hundreds : `${hundreds} ${underHundred(rest)}`;
}

export function numberToWords(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 999_999) return String(value);
  if (value < 1000) return underThousand(value);
  const thousands = `${underThousand(Math.floor(value / 1000))} thousand`;
  const rest = value % 1000;
  return rest === 0 ? thousands : `${thousands} ${underThousand(rest)}`;
}

const MONEY_PATTERN = /\$\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g;
const US_POSTAL_CODE_PATTERN = /\b([A-Z]{2})\s+(\d{5})(?:-(\d{4}))?\b/g;
const YEAR_PATTERN = /(?<![\d$])((?:19|20)\d{2})(?!\d)/g;
const GROUPED_NUMBER_PATTERN = /(?<![\d$.,])(\d{1,3}(?:,\d{3})+)(?!\.\d)/g;
const SPEECH_ANNOTATION_PATTERN = /\[[a-z][a-z '-]{0,38}\]/gi;

function digitsToWords(value: string) {
  return [...value].map((digit) => (digit === "0" ? "oh" : ONES[Number(digit)])).join(" ");
}

function yearToWords(value: string) {
  const firstHalf = Number(value.slice(0, 2));
  const secondHalf = Number(value.slice(2));
  if (secondHalf === 0) return numberToWords(Number(value));
  if (value.startsWith("20") && secondHalf < 10) return `two thousand ${ONES[secondHalf]}`;
  return `${underHundred(firstHalf)} ${underHundred(secondHalf)}`;
}

function moneyToWords(dollarDigits: string, centDigits: string | undefined): string {
  const dollars = Number(dollarDigits.replaceAll(",", ""));
  const cents = centDigits === undefined ? 0 : Number(centDigits.padEnd(2, "0"));
  if (dollars > 999_999) return `$${dollarDigits}${centDigits ? `.${centDigits}` : ""}`;
  const dollarWords = `${numberToWords(dollars)} ${dollars === 1 ? "dollar" : "dollars"}`;
  const centWords = `${numberToWords(cents)} ${cents === 1 ? "cent" : "cents"}`;
  if (cents === 0) return dollarWords;
  if (dollars === 0) return centWords;
  return `${dollarWords} and ${centWords}`;
}

export function speakableText(text: string): string {
  return text
    .replace(MONEY_PATTERN, (_match, dollarDigits: string, centDigits: string | undefined) =>
      moneyToWords(dollarDigits, centDigits),
    )
    .replace(
      US_POSTAL_CODE_PATTERN,
      (_match, region: string, postalCode: string, extension: string | undefined) =>
        `${region} ${digitsToWords(postalCode)}${extension ? `, extension ${digitsToWords(extension)}` : ""}`,
    )
    .replace(YEAR_PATTERN, (_match, year: string) => yearToWords(year))
    .replace(GROUPED_NUMBER_PATTERN, (match, digits: string) => {
      const value = Number(digits.replaceAll(",", ""));
      return value > 999_999 ? (match as string) : numberToWords(value);
    });
}

/**
 * Removes model-authored voice directions such as `[happy]`, `[whispers]`, or
 * `[laughs softly]`. These are control annotations, not conversation content,
 * so live simulation turns must not speak or display them.
 */
export function withoutSpeechAnnotations(text: string): string {
  return text
    .replace(SPEECH_ANNOTATION_PATTERN, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

export function spokenText(text: string): string {
  return speakableText(withoutSpeechAnnotations(text));
}
