import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertProductionSecrets,
  assertServerEnv,
  DEV_RATE_LIMIT_SALT,
} from "@/lib/serverEnv";
import { requiresSupabaseStore } from "@/lib/supabase";

describe("assertProductionSecrets", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.ADMIN_TOKEN;
    delete process.env.RATE_LIMIT_SALT;
    delete process.env.PLAN_IDEMPOTENCY_SECRET;
    delete process.env.CREW_DELIVERY_SIGNING_SECRET;
    delete process.env.CREW_DELIVERY_PREVIOUS_SIGNING_SECRET;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.NEXT_PHASE;
    delete process.env.PUBMAX_E2E_KEYLESS;
    delete process.env.VERCEL_ENV;
  });

  it("is a no-op outside production", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VERCEL_ENV", "development");
    expect(() => assertProductionSecrets()).not.toThrow();
  });

  it.each([
    ["the Next production build phase", "phase-production-build", undefined],
    ["explicit keyless E2E mode", undefined, "1"],
  ])("skips secret checks during %s", (_label, nextPhase, e2eKeyless) => {
    vi.stubEnv("NODE_ENV", "production");
    if (nextPhase) process.env.NEXT_PHASE = nextPhase;
    if (e2eKeyless) process.env.PUBMAX_E2E_KEYLESS = e2eKeyless;

    expect(() => assertProductionSecrets()).not.toThrow();
  });

  it("does not accept a truthy-looking value for keyless E2E mode", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.PUBMAX_E2E_KEYLESS = "true";

    expect(() => assertProductionSecrets()).toThrow(/ADMIN_TOKEN/);
  });

  it("ignores keyless E2E mode on a Vercel Production deploy", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    process.env.PUBMAX_E2E_KEYLESS = "1";

    expect(() => assertProductionSecrets()).toThrow(/ADMIN_TOKEN/);
    expect(() => assertServerEnv()).toThrow(/Supabase is not configured/);
    expect(requiresSupabaseStore()).toBe(true);
  });

  it("is a no-op on Vercel Preview even when NODE_ENV is production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "preview");
    delete process.env.ADMIN_TOKEN;
    expect(() => assertProductionSecrets()).not.toThrow();
  });
  it("throws when ADMIN_TOKEN is unset in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.ADMIN_TOKEN;
    process.env.RATE_LIMIT_SALT = "prod-salt";

    expect(() => assertProductionSecrets()).toThrow(/ADMIN_TOKEN/);
  });

  it("throws when ADMIN_TOKEN is blank in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.ADMIN_TOKEN = "   ";
    process.env.RATE_LIMIT_SALT = "prod-salt";

    expect(() => assertProductionSecrets()).toThrow(/ADMIN_TOKEN/);
  });

  it("throws when RATE_LIMIT_SALT is unset in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.ADMIN_TOKEN = "secret-admin";
    delete process.env.RATE_LIMIT_SALT;

    expect(() => assertProductionSecrets()).toThrow(/RATE_LIMIT_SALT/);
  });

  it("throws when RATE_LIMIT_SALT is still the dev default in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.ADMIN_TOKEN = "secret-admin";
    process.env.RATE_LIMIT_SALT = DEV_RATE_LIMIT_SALT;

    expect(() => assertProductionSecrets()).toThrow(/RATE_LIMIT_SALT/);
  });

  it("throws when RATE_LIMIT_SALT is too short for trusted production signing", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.ADMIN_TOKEN = "secret-admin";
    process.env.RATE_LIMIT_SALT = "unique-but-short";

    expect(() => assertProductionSecrets()).toThrow(/shorter than 32 bytes/);
  });

  it("allows RATE_LIMIT_SALT to remain the selected Plan mutation root", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.ADMIN_TOKEN = "secret-admin";
    process.env.RATE_LIMIT_SALT = "random-rate-limit-salt-0123456789abcdef";
    process.env.CREW_DELIVERY_SIGNING_SECRET = "crew-delivery-signing-secret-0123456789abcdef";
    delete process.env.PLAN_IDEMPOTENCY_SECRET;

    expect(() => assertProductionSecrets()).not.toThrow();
  });

  it("throws when the dedicated Plan mutation secret is too short", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.ADMIN_TOKEN = "secret-admin";
    process.env.RATE_LIMIT_SALT = "random-rate-limit-salt-0123456789abcdef";
    process.env.CREW_DELIVERY_SIGNING_SECRET = "crew-delivery-signing-secret-0123456789abcdef";
    process.env.PLAN_IDEMPOTENCY_SECRET = "too-short";

    expect(() => assertProductionSecrets()).toThrow(/PLAN_IDEMPOTENCY_SECRET/);
  });

  it("preserves a configured Plan root that already shares RATE_LIMIT_SALT", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.ADMIN_TOKEN = "secret-admin";
    process.env.RATE_LIMIT_SALT = "shared-production-secret-0123456789abcdef";
    process.env.PLAN_IDEMPOTENCY_SECRET = process.env.RATE_LIMIT_SALT;
    process.env.CREW_DELIVERY_SIGNING_SECRET = "crew-delivery-signing-secret-0123456789abcdef";

    expect(() => assertProductionSecrets()).not.toThrow();
  });

  it("requires a dedicated current crew delivery secret", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.ADMIN_TOKEN = "secret-admin";
    process.env.RATE_LIMIT_SALT = "random-rate-limit-salt-0123456789abcdef";
    delete process.env.CREW_DELIVERY_SIGNING_SECRET;

    expect(() => assertProductionSecrets()).toThrow(/CREW_DELIVERY_SIGNING_SECRET/);
  });

  it("keeps both crew delivery keys strong and pairwise isolated", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.ADMIN_TOKEN = "secret-admin";
    process.env.RATE_LIMIT_SALT = "rate-limit-secret-0123456789abcdef";
    process.env.PLAN_IDEMPOTENCY_SECRET = "stable-plan-identity-secret-0123456789abcdef";
    process.env.CREW_DELIVERY_SIGNING_SECRET = "current-crew-delivery-secret-0123456789abcdef";
    process.env.CREW_DELIVERY_PREVIOUS_SIGNING_SECRET = "too-short";
    expect(() => assertProductionSecrets()).toThrow(/CREW_DELIVERY_PREVIOUS_SIGNING_SECRET/);

    process.env.CREW_DELIVERY_PREVIOUS_SIGNING_SECRET = process.env.CREW_DELIVERY_SIGNING_SECRET;
    expect(() => assertProductionSecrets()).toThrow(/must differ from CREW_DELIVERY_SIGNING_SECRET/i);

    process.env.CREW_DELIVERY_PREVIOUS_SIGNING_SECRET = process.env.RATE_LIMIT_SALT;
    expect(() => assertProductionSecrets()).toThrow(/must differ from RATE_LIMIT_SALT/i);

    process.env.CREW_DELIVERY_PREVIOUS_SIGNING_SECRET = process.env.PLAN_IDEMPOTENCY_SECRET;
    expect(() => assertProductionSecrets()).toThrow(/must differ from PLAN_IDEMPOTENCY_SECRET/i);

    process.env.CREW_DELIVERY_PREVIOUS_SIGNING_SECRET = "previous-crew-delivery-secret-0123456789abcdef";
    process.env.CREW_DELIVERY_SIGNING_SECRET = process.env.RATE_LIMIT_SALT;
    expect(() => assertProductionSecrets()).toThrow(/CREW_DELIVERY_SIGNING_SECRET must differ from RATE_LIMIT_SALT/i);

    process.env.CREW_DELIVERY_SIGNING_SECRET = process.env.PLAN_IDEMPOTENCY_SECRET;
    expect(() => assertProductionSecrets()).toThrow(/CREW_DELIVERY_SIGNING_SECRET must differ from PLAN_IDEMPOTENCY_SECRET/i);
  });

  it("passes when production secrets are configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.ADMIN_TOKEN = "secret-admin";
    process.env.RATE_LIMIT_SALT = "unique-production-salt-0123456789abcdef";
    process.env.CREW_DELIVERY_SIGNING_SECRET = "crew-delivery-signing-secret-0123456789abcdef";

    expect(() => assertProductionSecrets()).not.toThrow();
  });

  it("enforces secrets when VERCEL_ENV=production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    delete process.env.ADMIN_TOKEN;
    process.env.RATE_LIMIT_SALT = "prod-salt";
    expect(() => assertProductionSecrets()).toThrow(/ADMIN_TOKEN/);
  });
});

describe("assertServerEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.ADMIN_TOKEN;
    delete process.env.RATE_LIMIT_SALT;
    delete process.env.PLAN_IDEMPOTENCY_SECRET;
    delete process.env.CREW_DELIVERY_SIGNING_SECRET;
    delete process.env.CREW_DELIVERY_PREVIOUS_SIGNING_SECRET;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.NEXT_PHASE;
    delete process.env.PUBMAX_E2E_KEYLESS;
    delete process.env.VERCEL_ENV;
  });

  it("is a no-op outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    delete process.env.SUPABASE_URL;
    expect(() => assertServerEnv()).not.toThrow();
  });

  it.each([
    ["the Next production build phase", "phase-production-build", undefined],
    ["explicit keyless E2E mode", undefined, "1"],
  ])("allows keyless operation during %s", (_label, nextPhase, e2eKeyless) => {
    vi.stubEnv("NODE_ENV", "production");
    if (nextPhase) process.env.NEXT_PHASE = nextPhase;
    if (e2eKeyless) process.env.PUBMAX_E2E_KEYLESS = e2eKeyless;

    expect(() => assertServerEnv()).not.toThrow();
  });

  it("still rejects keyless production requests outside the build phase", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PHASE = "phase-production-server";

    expect(() => assertServerEnv()).toThrow(/Supabase is not configured/);
  });

  it("is a no-op on Vercel Preview without Supabase", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "preview");
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => assertServerEnv()).not.toThrow();
  });
  it("throws when Supabase is missing in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    expect(() => assertServerEnv()).toThrow(/Supabase is not configured/);
  });

  it("throws when Supabase is configured but secrets are missing in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    delete process.env.ADMIN_TOKEN;
    process.env.RATE_LIMIT_SALT = "prod-salt";

    expect(() => assertServerEnv()).toThrow(/ADMIN_TOKEN/);
  });

  it("passes when Supabase and production secrets are configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    process.env.ADMIN_TOKEN = "secret-admin";
    process.env.RATE_LIMIT_SALT = "unique-production-salt-0123456789abcdef";
    process.env.CREW_DELIVERY_SIGNING_SECRET = "crew-delivery-signing-secret-0123456789abcdef";

    expect(() => assertServerEnv()).not.toThrow();
  });
});

describe("requiresSupabaseStore", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.PUBMAX_E2E_KEYLESS;
  });

  it("keeps production-style Playwright keyless writes on the in-memory store", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.PUBMAX_E2E_KEYLESS = "1";

    expect(requiresSupabaseStore()).toBe(false);
  });

  it("still requires durable storage for normal production runtime", () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.PUBMAX_E2E_KEYLESS;

    expect(requiresSupabaseStore()).toBe(true);
  });
});
