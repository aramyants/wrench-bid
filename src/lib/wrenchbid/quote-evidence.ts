export type QuoteEvidenceKind = "money" | "number" | "text" | "date";

export type QuoteEvidenceCandidate = {
  fieldName: string;
  kind: QuoteEvidenceKind;
  value: string | number;
};

type TranscriptTurn = {
  speaker: "agent" | "shop";
  text: string;
};

const NUMERIC_TOKEN_PATTERN =
  /(?<![\p{L}\p{N}.])(?:\$\s*)?(-?\d[\d,]*(?:\.\d+)?)(?![\p{L}\p{N}]|\.[\p{L}\p{N}])/gu;

function parseNumericToken(raw: string) {
  const unsigned = raw.startsWith("-") ? raw.slice(1) : raw;
  if (unsigned.includes(",") && !/^\d{1,3}(?:,\d{3})+$/.test(unsigned.split(".")[0])) {
    return undefined;
  }
  const parsed = Number(raw.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function numericTokens(text: string) {
  return Array.from(text.normalize("NFKC").matchAll(NUMERIC_TOKEN_PATTERN)).flatMap((match) => {
    const parsed = parseNumericToken(match[1]);
    return parsed === undefined ? [] : [parsed];
  });
}

function candidateNumber(value: string | number) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const tokens = numericTokens(value);
  return tokens.length === 1 ? tokens[0] : undefined;
}

function normalizePhrase(value: string | number) {
  return String(value)
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function transcriptSupportsQuoteEvidence(
  transcriptText: string,
  candidate: QuoteEvidenceCandidate,
) {
  if (candidate.kind === "money" || candidate.kind === "number") {
    const expected = candidateNumber(candidate.value);
    if (expected === undefined) return false;
    return numericTokens(transcriptText).some((actual) =>
      candidate.kind === "money"
        ? Math.round(actual * 100) === Math.round(expected * 100)
        : actual === expected,
    );
  }

  const expected = normalizePhrase(candidate.value);
  if (!expected) return false;
  const transcript = normalizePhrase(transcriptText);
  return ` ${transcript} `.includes(` ${expected} `);
}

export function findSupportingShopTurn<Turn extends TranscriptTurn>(
  turns: readonly Turn[],
  candidate: QuoteEvidenceCandidate,
) {
  return turns.find(
    (turn) => turn.speaker === "shop" && transcriptSupportsQuoteEvidence(turn.text, candidate),
  );
}
