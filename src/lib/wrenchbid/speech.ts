// Speech-side text normalization. Low-latency ElevenLabs models skip text
// normalization, so raw amounts like "$616.69" are voiced as mushy digit
// strings. Expanding money and large comma-grouped numbers into words before
// synthesis guarantees clarity on every model. Display text is never changed
// — only the string sent to the TTS API.

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

const MONEY_PATTERN = /\$\s*(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?/g;
const GROUPED_NUMBER_PATTERN = /(?<![\d$.,])(\d{1,3}(?:,\d{3})+)(?!\.\d)/g;

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
    .replace(GROUPED_NUMBER_PATTERN, (match, digits: string) => {
      const value = Number(digits.replaceAll(",", ""));
      return value > 999_999 ? (match as string) : numberToWords(value);
    });
}
