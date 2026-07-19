import type {
  AuditEvent,
  Call,
  Campaign,
  EvidenceSpan,
  Negotiation,
  Quote,
  RepairSpec,
  Session,
  Shop,
} from "./types";

export type DocumentSummary = {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  extractionStatus: "pending" | "completed" | "failed";
  createdAt: string;
};

export type SessionSummary = Session & { campaignId?: string };

export type RequestSnapshot = {
  session: Session;
  spec: RepairSpec;
  documents: DocumentSummary[];
  shops: Shop[];
};

export type CampaignSnapshot = {
  campaign: Campaign;
  spec: RepairSpec;
  shops: Shop[];
  calls: Call[];
  quotes: Quote[];
  evidence: EvidenceSpan[];
  negotiations: Negotiation[];
  audit?: AuditEvent[];
};

export type RuntimeCapabilities = {
  database: boolean;
  documentExtraction: boolean;
  tavily: boolean;
  voiceIntake: boolean;
  outboundCalls: boolean;
  negotiationCalls: boolean;
};
