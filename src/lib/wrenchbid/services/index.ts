// Typed service interfaces. Mock implementations only in Phase 1.
// Real adapters will replace mocks without touching UI code.

import type { RepairSpec, Shop, Quote, Call } from "../types";

export interface OpenAIService {
  extractRepairSpec(fileName: string): Promise<Partial<RepairSpec>>;
  normalizeQuote(transcript: Call["transcript"], spec: RepairSpec): Promise<Partial<Quote>>;
  generateReport(quotes: Quote[]): Promise<{ summary: string }>;
}

export interface ElevenLabsService {
  startIntakeConversation(
    spec: RepairSpec,
    onTurn: (turn: { role: "agent" | "customer"; text: string }) => void,
  ): Promise<{ conversationId: string; end: () => void }>;
  startQuoteCalls(campaignId: string): Promise<{ started: boolean }>;
  startNegotiationCall(negotiationId: string): Promise<{ started: boolean }>;
  getConversation(id: string): Promise<{ id: string; transcript: unknown[] }>;
}

export interface TavilyService {
  discoverShops(query: string, location: string): Promise<Shop[]>;
  extractShopPage(url: string): Promise<{ text: string }>;
}

// --- Mock implementations ---

const INTAKE_SCRIPT: Array<{
  role: "agent" | "customer";
  text: string;
  delayMs: number;
  fieldUpdate?: { path: string; value: unknown };
}> = [
  {
    role: "agent",
    text: "Hi — I'm confirming the details for your Camry brake job. Quick questions, then we'll call shops.",
    delayMs: 1200,
  },
  {
    role: "agent",
    text: "The estimate reads 52,000 miles. Is your current mileage close to that, or higher?",
    delayMs: 3400,
  },
  {
    role: "customer",
    text: "It's closer to 62,000 now.",
    delayMs: 2200,
    fieldUpdate: { path: "vehicle.mileage", value: 62000 },
  },
  {
    role: "agent",
    text: "Got it — noting 62,000. Are you okay with premium aftermarket pads and rotors?",
    delayMs: 2800,
  },
  { role: "customer", text: "Yes, premium aftermarket is fine.", delayMs: 1800 },
  { role: "agent", text: "When do you need this done by?", delayMs: 1400 },
  {
    role: "customer",
    text: "Within a week.",
    delayMs: 1400,
    fieldUpdate: { path: "completionByDays", value: 7 },
  },
  {
    role: "agent",
    text: "Perfect. I have everything I need. Review the spec on the next screen.",
    delayMs: 2000,
  },
];

export const mockElevenLabs: ElevenLabsService = {
  async startIntakeConversation(_spec, onTurn) {
    let cancelled = false;
    let acc = 0;
    for (const step of INTAKE_SCRIPT) {
      acc += step.delayMs;
      setTimeout(() => {
        if (cancelled) return;
        onTurn({ role: step.role, text: step.text });
        if (step.fieldUpdate) {
          // Delegate to store via dynamic import to avoid circular dep
          import("../store").then(({ useWrenchStore }) => {
            const spec = _spec;
            useWrenchStore
              .getState()
              .updateSpecField(spec.id, step.fieldUpdate!.path, step.fieldUpdate!.value, "voice");
          });
        }
      }, acc);
    }
    return {
      conversationId: "conv_mock_" + Date.now().toString(36),
      end: () => {
        cancelled = true;
      },
    };
  },
  async startQuoteCalls() {
    return { started: true };
  },
  async startNegotiationCall() {
    return { started: true };
  },
  async getConversation(id) {
    return { id, transcript: [] };
  },
};

export const mockOpenAI: OpenAIService = {
  async extractRepairSpec() {
    return {};
  },
  async normalizeQuote() {
    return {};
  },
  async generateReport(quotes) {
    const best = quotes.reduce((a, b) => ((a.total ?? 1e9) < (b.total ?? 1e9) ? a : b));
    return { summary: `Recommended based on completeness + total: ${best.id}` };
  },
};

export const mockTavily: TavilyService = {
  async discoverShops() {
    return [];
  },
  async extractShopPage() {
    return { text: "" };
  },
};

export const INTAKE_TOTAL_MS = INTAKE_SCRIPT.reduce((a, s) => a + s.delayMs, 0);
