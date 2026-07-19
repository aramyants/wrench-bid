// Typed service interfaces. Mock implementations only in Phase 1.
// Real adapters will replace mocks without touching UI code.

import type { RepairSpec, Shop, Quote, Call } from "../types";
import { DEMO_INTAKE_TURNS } from "../demo-intake";

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

export const mockElevenLabs: ElevenLabsService = {
  async startIntakeConversation(_spec, onTurn) {
    let cancelled = false;
    let acc = 0;
    for (const step of DEMO_INTAKE_TURNS) {
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

export const INTAKE_TOTAL_MS = DEMO_INTAKE_TURNS.reduce((a, s) => a + s.delayMs, 0);
