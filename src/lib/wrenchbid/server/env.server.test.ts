import { describe, expect, it } from "vitest";
import { parseServerEnvironment } from "./env.server";

describe("server environment", () => {
  it("converts strict boolean values to booleans and applies safe defaults", () => {
    const defaults = parseServerEnvironment({});
    const configured = parseServerEnvironment({
      ALLOW_ANONYMOUS_PROJECTS: "false",
      OUTBOUND_CALLS_ENABLED: "true",
    });

    expect(defaults.ALLOW_ANONYMOUS_PROJECTS).toBe(true);
    expect(defaults.OUTBOUND_CALLS_ENABLED).toBe(false);
    expect(configured.ALLOW_ANONYMOUS_PROJECTS).toBe(false);
    expect(configured.OUTBOUND_CALLS_ENABLED).toBe(true);
    expect(() => parseServerEnvironment({ OUTBOUND_CALLS_ENABLED: "yes" })).toThrow();
  });

  it("treats copied blank optional provider settings as unconfigured", () => {
    const environment = parseServerEnvironment({
      DATABASE_URL: " ",
      ELEVENLABS_API_KEY: "",
      ELEVENLABS_INTAKE_AGENT_ID: "  ",
      ELEVENLABS_CALLER_AGENT_ID: "",
      ELEVENLABS_NEGOTIATOR_AGENT_ID: "",
      ELEVENLABS_PHONE_NUMBER_ID: "",
      ELEVENLABS_WEBHOOK_SECRET: "",
      TAVILY_API_KEY: "",
      WOZ_API_KEY: "",
      WOZ_API_BASE_URL: "",
    });

    expect(environment.DATABASE_URL).toBeUndefined();
    expect(environment.ELEVENLABS_API_KEY).toBeUndefined();
    expect(environment.ELEVENLABS_INTAKE_AGENT_ID).toBeUndefined();
    expect(environment.ELEVENLABS_CALLER_AGENT_ID).toBeUndefined();
    expect(environment.ELEVENLABS_NEGOTIATOR_AGENT_ID).toBeUndefined();
    expect(environment.ELEVENLABS_PHONE_NUMBER_ID).toBeUndefined();
    expect(environment.ELEVENLABS_WEBHOOK_SECRET).toBeUndefined();
    expect(environment.TAVILY_API_KEY).toBeUndefined();
    expect(environment.WOZ_API_KEY).toBeUndefined();
    expect(environment.WOZ_API_BASE_URL).toBeUndefined();
  });

  it("trims configured optional values before use", () => {
    const environment = parseServerEnvironment({
      DATABASE_URL: " postgresql://user:password@localhost:5432/wrenchbid ",
      TAVILY_API_KEY: " test-token ",
    });

    expect(environment.DATABASE_URL).toBe("postgresql://user:password@localhost:5432/wrenchbid");
    expect(environment.TAVILY_API_KEY).toBe("test-token");
  });
});
