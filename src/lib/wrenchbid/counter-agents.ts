import { subtractAmounts } from "./money";

export type CounterAgentId = "budget" | "precision" | "queencity";

export type CounterAgentTurn = {
  id: string;
  speaker: "wrenchbid" | "counter";
  text: string;
  evidenceFields?: string[];
};

export type CounterAgentProfile = {
  id: CounterAgentId;
  shopId: string;
  shopName: string;
  publicStyle: string;
  behavior: "hidden_fees" | "transparent" | "evasive";
  quote: {
    headline?: number;
    range?: [number, number];
    parts: number;
    labor: number;
    diagnostic: number;
    shopSupply: number;
    disposal: number;
    tax: number;
    total: number;
    warranty: string;
    appointment: string;
    validForDays: number;
    conditions: string[];
  };
  privatePolicy: {
    summary: string;
    negotiationFloor: number;
    concessionRule: string;
  };
};

export const DEMO_REPAIR_SPEC_SUMMARY =
  "2020 Toyota Camry SE, 62,000 miles; replace front brake pads and rotors with premium aftermarket parts; Charlotte, NC 28202; completion within 7 days";

export const DEMO_COUNTER_AGENTS: CounterAgentProfile[] = [
  {
    id: "budget",
    shopId: "shop_budget",
    shopName: "Budget Brake Center",
    publicStyle: "Low headline · fees only when challenged",
    behavior: "hidden_fees",
    quote: {
      headline: 489,
      parts: 285,
      labor: 204,
      diagnostic: 0,
      shopSupply: 45,
      disposal: 0,
      tax: 40,
      total: 574,
      warranty: "90 days, parts and labor",
      appointment: "Thursday morning",
      validForDays: 7,
      conditions: [],
    },
    privatePolicy: {
      summary: "Lead with parts + labor. Reveal the $45 shop fee only after a direct fee question.",
      negotiationFloor: 565,
      concessionRule: "May waive $9, but will not extend the short warranty.",
    },
  },
  {
    id: "precision",
    shopId: "shop_precision",
    shopName: "Precision Auto Works",
    publicStyle: "Complete itemization · premium warranty",
    behavior: "transparent",
    quote: {
      parts: 312,
      labor: 228,
      diagnostic: 0,
      shopSupply: 28,
      disposal: 0,
      tax: 48.69,
      total: 616.69,
      warranty: "12 months / 12,000 miles",
      appointment: "Two days from now",
      validForDays: 14,
      conditions: [],
    },
    privatePolicy: {
      summary: "Protect the premium warranty. Concede only when a real competing quote is named.",
      negotiationFloor: 585,
      concessionRule:
        "With verified leverage, waive supplies and make one price adjustment to $585.",
    },
  },
  {
    id: "queencity",
    shopId: "shop_queencity",
    shopName: "Queen City Garage",
    publicStyle: "Gruff range · must be pressed for a firm total",
    behavior: "evasive",
    quote: {
      range: [620, 720],
      parts: 305,
      labor: 260,
      diagnostic: 0,
      shopSupply: 35,
      disposal: 5,
      tax: 40,
      total: 645,
      warranty: "6 months",
      appointment: "Three days from now",
      validForDays: 5,
      conditions: ["Visual inspection required before commitment"],
    },
    privatePolicy: {
      summary: "Start with a range and push an inspection. Itemize only after scope is repeated.",
      negotiationFloor: 620,
      concessionRule: "Will firm the quote, but will not remove the inspection condition.",
    },
  },
];

function usd(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function turn(
  profile: CounterAgentProfile,
  index: number,
  speaker: CounterAgentTurn["speaker"],
  text: string,
  evidenceFields?: string[],
): CounterAgentTurn {
  return { id: `${profile.id}-${index}`, speaker, text, evidenceFields };
}

function finalConfirmation(profile: CounterAgentProfile, startIndex: number) {
  const quote = profile.quote;
  return [
    turn(
      profile,
      startIndex,
      "wrenchbid",
      "Please confirm the final all-in total, warranty, earliest appointment, and how long the quote holds.",
    ),
    turn(
      profile,
      startIndex + 1,
      "counter",
      `Final all-in total is ${usd(quote.total)}. Warranty is ${quote.warranty}. Earliest is ${quote.appointment}, and the quote holds for ${quote.validForDays} days.${quote.conditions.length ? ` Condition: ${quote.conditions.join("; ")}.` : ""}`,
      ["all_in_total", "warranty", "earliest_appointment", "quote_expiration"],
    ),
  ];
}

export function buildQuoteConversation(profile: CounterAgentProfile): CounterAgentTurn[] {
  const quote = profile.quote;
  const opening = turn(
    profile,
    0,
    "wrenchbid",
    `Hi, I’m WrenchBid, an AI assistant calling for a customer. I need an itemized quote for this confirmed scope: ${DEMO_REPAIR_SPEC_SUMMARY}.`,
  );

  if (profile.behavior === "transparent") {
    return [
      opening,
      turn(
        profile,
        1,
        "counter",
        `Sure. Parts are ${usd(quote.parts)}, labor ${usd(quote.labor)}, shop supplies ${usd(quote.shopSupply)}, diagnostic ${usd(quote.diagnostic)}, and tax ${usd(quote.tax)}.`,
        ["parts", "labor", "shop_supply_fee", "diagnostic_fee", "tax"],
      ),
      ...finalConfirmation(profile, 2),
    ];
  }

  if (profile.behavior === "hidden_fees") {
    return [
      opening,
      turn(
        profile,
        1,
        "counter",
        `Pads and rotors are ${usd(quote.headline ?? quote.parts + quote.labor)}.`,
        ["parts", "labor"],
      ),
      turn(
        profile,
        2,
        "wrenchbid",
        "Is that truly all-in? Please identify shop supplies, diagnostic, disposal, tax, and any other charge separately.",
      ),
      turn(
        profile,
        3,
        "counter",
        `That first number was parts and labor. Shop supplies are ${usd(quote.shopSupply)}, diagnostic and disposal are ${usd(quote.diagnostic + quote.disposal)}, and tax is ${usd(quote.tax)}.`,
        ["shop_supply_fee", "diagnostic_fee", "disposal_fee", "tax"],
      ),
      ...finalConfirmation(profile, 4),
    ];
  }

  return [
    opening,
    turn(
      profile,
      1,
      "counter",
      `It depends on the rotors. Somewhere from ${usd(quote.range?.[0] ?? quote.total)} to ${usd(quote.range?.[1] ?? quote.total)}. Bring it in and we’ll know.`,
    ),
    turn(
      profile,
      2,
      "wrenchbid",
      "The rotors and parts grade are already specified. Please quote that exact scope and separate parts, labor, supplies, disposal, and tax.",
    ),
    turn(
      profile,
      3,
      "counter",
      `Fine. Parts ${usd(quote.parts)}, labor ${usd(quote.labor)}, supplies ${usd(quote.shopSupply)}, disposal ${usd(quote.disposal)}, and tax ${usd(quote.tax)}.`,
      ["parts", "labor", "shop_supply_fee", "disposal_fee", "tax"],
    ),
    ...finalConfirmation(profile, 4),
  ];
}

export type NegotiationAsk =
  | "beat_or_match"
  | "waive_diagnostic"
  | "waive_shop_supply"
  | "better_warranty"
  | "earlier_appointment";

export function buildNegotiationConversation(input: {
  target: CounterAgentProfile;
  leverageQuoteId?: string;
  leverageShopName?: string;
  leverageTotal?: number;
  leverageVerified: boolean;
  asks: NegotiationAsk[];
}) {
  const { target, asks } = input;
  const quote = target.quote;
  const genuineLeverage =
    input.leverageVerified &&
    Boolean(input.leverageQuoteId) &&
    typeof input.leverageTotal === "number" &&
    input.leverageTotal > 0 &&
    input.leverageTotal < quote.total;
  const priceAsk = asks.includes("beat_or_match") || asks.includes("waive_shop_supply");
  const revisedTotal =
    genuineLeverage && priceAsk ? target.privatePolicy.negotiationFloor : quote.total;
  const revised = revisedTotal < quote.total;
  const leverageSentence = genuineLeverage
    ? `I have stored quote ${input.leverageQuoteId} from ${input.leverageShopName} at ${usd(input.leverageTotal as number)} all-in.`
    : "I do not have a verified competing quote, so I will not claim one.";
  const askSentence = [
    asks.includes("beat_or_match") ? "beat or approach that total" : undefined,
    asks.includes("waive_shop_supply") ? "waive the shop-supply fee" : undefined,
    asks.includes("better_warranty") ? "improve the warranty" : undefined,
    asks.includes("earlier_appointment") ? "offer an earlier appointment" : undefined,
  ]
    .filter(Boolean)
    .join(" and ");

  const turns: CounterAgentTurn[] = [
    turn(
      target,
      100,
      "wrenchbid",
      `I’m WrenchBid, the customer’s AI assistant, following up on your ${usd(quote.total)} quote for the same confirmed brake-service scope.`,
    ),
    turn(
      target,
      101,
      "counter",
      `I have it here: ${usd(quote.total)} all-in with the ${quote.warranty} warranty.`,
      ["all_in_total", "warranty"],
    ),
    turn(
      target,
      102,
      "wrenchbid",
      `${leverageSentence} The customer authorized me to ask you to ${askSentence || "confirm your best available terms"}.`,
    ),
    turn(
      target,
      103,
      "counter",
      revised
        ? `I can’t match that while keeping our warranty, but I can waive supplies and make one adjustment. My revised all-in total is ${usd(revisedTotal)}; the ${quote.warranty} warranty stays.`
        : genuineLeverage
          ? `I can’t improve the price under those asks. The all-in total remains ${usd(quote.total)}.`
          : `Without a verified competing quote, the all-in total remains ${usd(quote.total)}.`,
      ["all_in_total", "warranty"],
    ),
    turn(
      target,
      104,
      "wrenchbid",
      `Confirmed: ${usd(revisedTotal)} all-in, ${quote.warranty}, valid for ${quote.validForDays} days. I’ll present that exact outcome to the customer.`,
      ["all_in_total", "warranty", "quote_expiration"],
    ),
  ];

  return {
    turns,
    before: quote.total,
    after: revisedTotal,
    savings: Math.max(0, subtractAmounts(quote.total, revisedTotal)),
    outcome: revised ? ("revised" as const) : ("unchanged" as const),
    leverageAccepted: genuineLeverage,
  };
}
