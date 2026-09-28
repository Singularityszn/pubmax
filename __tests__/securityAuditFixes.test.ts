import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as versionGet } from "@/app/api/version/route";
import { PRODUCTION_SERVER_URL, nativeServerUrl } from "../capacitor.config";
import { supabaseCspOrigins } from "@/lib/supabaseCsp";
import { serverEnvRefusalResponse } from "@/lib/serverEnv";
import { securityProxy } from "../proxy";
import { NextRequest } from "next/server";

describe("security audit F-01 — Capacitor server.url prefix", () => {
  it("ends production server.url with a slash so look-alike hosts are not in-app navigation", () => {
    expect(PRODUCTION_SERVER_URL).toBe("https://pubmaxxing.com/");
    const serverUrl = nativeServerUrl({});
    expect("https://pubmaxxing.com.evil.example/".startsWith(serverUrl)).toBe(false);
    expect("https://pubmaxxing.com@evil.example/".startsWith(serverUrl)).toBe(false);
    expect("https://pubmaxxing.com/tonight".startsWith(serverUrl)).toBe(true);
  });
});

describe("security audit F-02 — Supabase CSP pinning", () => {
  it("derives exact https and wss origins from NEXT_PUBLIC_SUPABASE_URL", () => {
    expect(
      supabaseCspOrigins({ NEXT_PUBLIC_SUPABASE_URL: "https://abc123.supabase.co" }),
    ).toEqual({
      https: "https://abc123.supabase.co",
      wss: "wss://abc123.supabase.co",
    });
    expect(supabaseCspOrigins({})).toBeNull();
  });

  it("does not emit a wildcard supabase.co allowance in proxy CSP", () => {
    vi.stubEnv("NODE_ENV", "production");
    const request = new NextRequest("https://pubmaxxing.com/map");
    const response = securityProxy(request);
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).not.toContain("https://*.supabase.co");
    expect(csp).not.toContain("wss://*.supabase.co");
    vi.unstubAllEnvs();
  });
});

describe("security audit F-05 — /api/version reconnaissance", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.CRON_SECRET;
    delete process.env.PUBMAX_BUILD_COMMIT_SHA;
    delete process.env.PUBMAX_BUILD_COMMIT_SHA_SOURCE;
    delete process.env.PUBMAX_BUILD_TIME;
  });

  it("returns only ok for anonymous callers", async () => {
    process.env.CRON_SECRET = "cron-test-secret";
    process.env.PUBMAX_BUILD_COMMIT_SHA = "abc";
    const response = versionGet();
    const body = await response.json();
    expect(body).toEqual({ ok: true });
    expect(body).not.toHaveProperty("gitCommitSha");
  });

  it("returns build metadata when cron credential matches", async () => {
    process.env.CRON_SECRET = "cron-test-secret";
    process.env.PUBMAX_BUILD_COMMIT_SHA = "182aa88212fc58cd2d146a5c3a4a91efe4c6a1fb";
    process.env.PUBMAX_BUILD_COMMIT_SHA_SOURCE = "working-tree";
    process.env.PUBMAX_BUILD_TIME = "2026-09-05T07:30:00.000Z";

    const response = versionGet(
      new Request("http://localhost/api/version", {
        headers: { authorization: "Bearer cron-test-secret" },
      }),
    );
    const body = await response.json();
    expect(body.gitCommitSha).toBe("182aa88212fc58cd2d146a5c3a4a91efe4c6a1fb");
  });
});

describe("security audit F-06 — keys.env gitignore", () => {
  it("ignores keys.env and arbitrary *.env files", () => {
    const root = process.cwd();
    for (const path of ["keys.env", "data/keys.env", "secrets/prod.env"]) {
      const out = execSync(`git check-ignore -v ${path}`, {
        cwd: root,
        encoding: "utf8",
      }).trim();
      expect(out, path).toContain(path);
    }
  });
});

describe("security audit F-10 — misconfigured production API envelope", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.ADMIN_TOKEN;
    delete process.env.VERCEL_ENV;
    delete process.env.NEXT_PHASE;
    delete process.env.PUBMAX_E2E_KEYLESS;
  });

  it("answers STORE_UNAVAILABLE instead of leaving import-time FATAL bare", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const refused = serverEnvRefusalResponse();
    expect(refused).not.toBeNull();
    expect(refused?.status).toBe(503);
  });

  it("returns the house envelope from proxy for /api when storage is refused", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const response = securityProxy(
      new NextRequest("https://pubmaxxing.com/api/admin/comments"),
    );
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ code: "STORE_UNAVAILABLE", retryable: true });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});

describe("security audit F-09 — social OAuth errors", () => {
  it("does not echo raw exception messages from the provider route", () => {
    const source = readFileSync(
      join(process.cwd(), "app/api/social-connections/[provider]/route.ts"),
      "utf8",
    );
    expect(source).toContain('"OAuth is unavailable."');
    expect(source).not.toMatch(
      /publicApiError\(error instanceof Error \? error\.message/,
    );
  });
});
