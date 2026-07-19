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

const MONEY_FIELD_CUES: Partial<Record<string, RegExp>> = {
  parts: /\b(?:parts?|pads?|rotors?|materials?)\b/iu,
  labor: /\blabou?r\b/iu,
  diagnostic_fee: /\bdiagnostic(?:\s+(?:fee|charge))?\b/iu,
  shop_supply_fee:
    /\b(?:shop\s+suppl(?:y|ies)|suppl(?:y|ies)(?:\s+(?:fee|charge))?|shop\s+fee)\b/iu,
  disposal_fee: /\b(?:(?:disposal|recycling|environmental)(?:\s+(?:fee|charge))?)\b/iu,
  tax: /\b(?:sales\s+)?tax(?:es)?\b/iu,
  all_in_total:
    /\b(?:all[\s-]?in|final\s+(?:price|total)|grand\s+total|total|out[\s-]?the[\s-]?door|with\s+everything|everything\s+(?:included|in)|comes?\s+to)\b/iu,
};

const INSTRUCTIONAL_SPEECH_PATTERN =
  /\b(?:ignore\s+(?:all\s+)?(?:previous|prior|above)?\s*instructions?|you\s+are\s+now\s+authorized|system\s+prompt|developer\s+message|override\s+(?:your|the)\s+instructions?)\b/iu;

const ZERO_TERM_PATTERN =
  /\b(?:zero|waived|waive|free|complimentary|no\s+charge|no\s+fee|exempt)\b/iu;

function evidenceFragments(text: string) {
  return text
    .normalize("NFKC")
    .split(/\r?\n|,(?=\s)|;|\.(?!\d)|[!?]/u)
    .map((fragment) => fragment.trim())
    .filter(Boolean);
}

function hasExplicitZero(fragment: string, fieldName: string, cue: RegExp) {
  if (/\bnot\s+(?:waived|free|complimentary|exempt)\b/iu.test(fragment)) return false;
  if (!cue.test(fragment)) return false;
  cue.lastIndex = 0;
  const noField = new RegExp(`\\bno\\s+(?:separate\\s+)?(?:${cue.source})`, "iu");
  if (noField.test(fragment)) return true;

  const zeroTerms = Array.from(
    fragment.matchAll(
      new RegExp(ZERO_TERM_PATTERN.source, `${ZERO_TERM_PATTERN.flags.replace("g", "")}g`),
    ),
  ).map((match) => ({ index: match.index, end: match.index + match[0].length }));
  const cues = cueSpans(fragment);
  if (
    zeroTerms.length === 1 &&
    numericTokenSpans(fragment).length === 0 &&
    /\b(?:and|both)\b|\//iu.test(fragment)
  ) {
    return cues.some((candidate) => candidate.fieldName === fieldName);
  }
  return zeroTerms.some((term) => {
    const nearest = [...cues].sort(
      (left, right) => spanDistance(left, term) - spanDistance(right, term),
    )[0];
    return nearest?.fieldName === fieldName;
  });
}

function supportsFieldSpecificMoney(transcriptText: string, fieldName: string, expected: number) {
  const cue = MONEY_FIELD_CUES[fieldName];
  if (!cue || INSTRUCTIONAL_SPEECH_PATTERN.test(transcriptText)) return false;

  return evidenceFragments(transcriptText).some((fragment) => {
    if (!cue.test(fragment)) return false;
    cue.lastIndex = 0;
    if (expected === 0 && hasExplicitZero(fragment, fieldName, cue)) return true;
    const numeric = numericTokenSpans(fragment);
    const cues = cueSpans(fragment);
    if (
      expected === 0 &&
      numeric.length === 1 &&
      numeric[0].value === 0 &&
      cues.some((candidate) => candidate.fieldName === fieldName) &&
      /\b(?:and|both)\b|\//iu.test(fragment)
    ) {
      return true;
    }
    return numeric.some((token) => {
      if (Math.round(token.value * 100) !== Math.round(expected * 100)) return false;
      const nearest = [...cues].sort(
        (left, right) => spanDistance(left, token) - spanDistance(right, token),
      )[0];
      return nearest?.fieldName === fieldName;
    });
  });
}

function parseNumericToken(raw: string) {
  const token = raw.replace(/,+$/, "");
  const unsigned = token.startsWith("-") ? token.slice(1) : token;
  if (unsigned.includes(",") && !/^\d{1,3}(?:,\d{3})+$/.test(unsigned.split(".")[0])) {
    return undefined;
  }
  const parsed = Number(token.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function numericTokens(text: string) {
  return Array.from(text.normalize("NFKC").matchAll(NUMERIC_TOKEN_PATTERN)).flatMap((match) => {
    const parsed = parseNumericToken(match[1]);
    return parsed === undefined ? [] : [parsed];
  });
}

function numericTokenSpans(text: string) {
  return Array.from(text.normalize("NFKC").matchAll(NUMERIC_TOKEN_PATTERN)).flatMap((match) => {
    const parsed = parseNumericToken(match[1]);
    const index = match.index;
    return parsed === undefined || index === undefined
      ? []
      : [{ value: parsed, index, end: index + match[0].length }];
  });
}

function cueSpans(fragment: string) {
  return Object.entries(MONEY_FIELD_CUES).flatMap(([fieldName, cue]) => {
    if (!cue) return [];
    const matches = fragment.matchAll(new RegExp(cue.source, `${cue.flags.replace("g", "")}g`));
    return Array.from(matches).map((match) => ({
      fieldName,
      index: match.index,
      end: match.index + match[0].length,
    }));
  });
}

function spanDistance(left: { index: number; end: number }, right: { index: number; end: number }) {
  if (left.end <= right.index) return right.index - left.end;
  if (right.end <= left.index) return left.index - right.end;
  return 0;
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
    if (candidate.kind === "money" && MONEY_FIELD_CUES[candidate.fieldName]) {
      return supportsFieldSpecificMoney(transcriptText, candidate.fieldName, expected);
    }
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
