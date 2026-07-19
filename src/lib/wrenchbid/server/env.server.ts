import { z } from "zod";

function normalizeOptionalEnvironmentValue(value: unknown) {
  if (typeof value !== "string") return value;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

const optionalString = z.preprocess(
  normalizeOptionalEnvironmentValue,
  z.string().min(1).optional(),
);
const optionalUrl = z.preprocess(normalizeOptionalEnvironmentValue, z.string().url().optional());

function environmentBoolean(defaultValue: boolean) {
  return z
    .enum(["true", "false"])
    .default(defaultValue ? "true" : "false")
    .transform((value) => value === "true");
}

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: optionalUrl,
  UPLOAD_DIR: z.string().default("./data/uploads"),
  PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  ALLOW_ANONYMOUS_PROJECTS: environmentBoolean(true),
  OUTBOUND_CALLS_ENABLED: environmentBoolean(false),
  MAX_CAMPAIGNS_PER_PROJECT_PER_DAY: z.coerce.number().int().min(1).max(100).default(3),
  SUPPRESSED_PHONE_NUMBERS: z.string().default(""),
  RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  ELEVENLABS_API_KEY: optionalString,
  ELEVENLABS_INTAKE_AGENT_ID: optionalString,
  ELEVENLABS_CALLER_AGENT_ID: optionalString,
  ELEVENLABS_NEGOTIATOR_AGENT_ID: optionalString,
  ELEVENLABS_PHONE_NUMBER_ID: optionalString,
  ELEVENLABS_WEBHOOK_SECRET: optionalString,
  ELEVENLABS_TELEPHONY_PROVIDER: z.enum(["twilio", "sip"]).default("twilio"),
  ELEVENLABS_ENVIRONMENT: z.string().min(1).default("production"),
  TAVILY_API_KEY: optionalString,
  WOZ_API_KEY: optionalString,
  WOZ_API_BASE_URL: optionalUrl,
});

export type ServerEnvironment = z.infer<typeof EnvironmentSchema>;

let cachedEnvironment: ServerEnvironment | undefined;

export function parseServerEnvironment(
  environment: Record<string, string | undefined>,
): ServerEnvironment {
  return EnvironmentSchema.parse(environment);
}

export function getServerEnvironment() {
  cachedEnvironment ??= parseServerEnvironment(process.env);
  return cachedEnvironment;
}

export function requireDatabaseUrl() {
  const value = getServerEnvironment().DATABASE_URL;
  if (!value) throw new Error("Database is not configured");
  return value;
}

export function getPublicCapabilities() {
  const environment = getServerEnvironment();
  const outboundInfrastructure = Boolean(
    environment.OUTBOUND_CALLS_ENABLED &&
    environment.ELEVENLABS_API_KEY &&
    environment.ELEVENLABS_PHONE_NUMBER_ID &&
    environment.ELEVENLABS_WEBHOOK_SECRET,
  );
  return {
    database: Boolean(environment.DATABASE_URL),
    documentExtraction: Boolean(environment.DATABASE_URL),
    tavily: Boolean(environment.TAVILY_API_KEY),
    voiceIntake: Boolean(environment.ELEVENLABS_API_KEY && environment.ELEVENLABS_INTAKE_AGENT_ID),
    outboundCalls: Boolean(outboundInfrastructure && environment.ELEVENLABS_CALLER_AGENT_ID),
    negotiationCalls: Boolean(outboundInfrastructure && environment.ELEVENLABS_NEGOTIATOR_AGENT_ID),
  };
}
