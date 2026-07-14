import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertProductionSecrets,
  assertServerEnv,
  DEV_RATE_LIMIT_SALT,
} from "@/lib/serverEnv";

describe("assertProductionSecrets", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.ADMIN_TOKEN;
    delete process.env.RATE_LIMIT_SALT;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.VERCEL_ENV;
  });

  it("is a no-op outside production", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(() => assertProductionSecrets()).not.toThrow();
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

  it("passes when production secrets are configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.ADMIN_TOKEN = "secret-admin";
    process.env.RATE_LIMIT_SALT = "unique-prod-salt";

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
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.VERCEL_ENV;
  });

  it("is a no-op outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    delete process.env.SUPABASE_URL;
    expect(() => assertServerEnv()).not.toThrow();
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
    process.env.RATE_LIMIT_SALT = "unique-prod-salt";

    expect(() => assertServerEnv()).not.toThrow();
  });
});
