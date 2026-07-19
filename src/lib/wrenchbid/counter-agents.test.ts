import { describe, expect, it } from "vitest";
import {
  buildNegotiationConversation,
  buildQuoteConversation,
  DEMO_COUNTER_AGENTS,
} from "./counter-agents";
import { spokenText } from "./speech";

describe("counter-agent demo market", () => {
  it("uses three distinct behaviors and voices every final total", () => {
    expect(new Set(DEMO_COUNTER_AGENTS.map((agent) => agent.behavior)).size).toBe(3);
    for (const agent of DEMO_COUNTER_AGENTS) {
      const transcript = buildQuoteConversation(agent)
        .filter((turn) => turn.speaker === "counter")
        .map((turn) => turn.text)
        .join(" ");
      expect(transcript).toContain(
        new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
          agent.quote.total,
        ),
      );
    }
  });

  it("changes price only when genuine stored leverage and an approved price ask are present", () => {
    const target = DEMO_COUNTER_AGENTS.find((agent) => agent.id === "precision")!;
    const revised = buildNegotiationConversation({
      target,
      leverageQuoteId: "q_budget",
      leverageShopName: "Budget Brake Center",
      leverageTotal: 574,
      leverageVerified: true,
      asks: ["beat_or_match", "waive_shop_supply"],
    });
    expect(revised.outcome).toBe("revised");
    expect(revised.before).toBe(616.69);
    expect(revised.after).toBe(585);

    const unsupported = buildNegotiationConversation({
      target,
      leverageQuoteId: undefined,
      leverageShopName: undefined,
      leverageTotal: undefined,
      leverageVerified: false,
      asks: ["beat_or_match"],
    });
    expect(unsupported.outcome).toBe("unchanged");
    expect(unsupported.after).toBe(616.69);
  });

  it("sends the dense itemization to TTS as paced words rather than numeric tokens", () => {
    const precision = DEMO_COUNTER_AGENTS.find((agent) => agent.id === "precision")!;
    const itemization = buildQuoteConversation(precision)[1].text;
    const speech = spokenText(itemization);

    expect(speech).not.toMatch(/[\d$]/);
    expect(speech).toContain("Parts are three hundred twelve dollars.");
    expect(speech).toContain("Tax is forty-eight dollars and sixty-nine cents.");
  });
});
