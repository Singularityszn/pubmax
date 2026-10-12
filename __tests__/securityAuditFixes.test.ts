import { execSync } from "node:child_process";

import { afterEach, describe, expect, it, vi } from "vitest";

const createSocialOAuthStartMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/serverEnv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/serverEnv")>();
  return { ...actual, assertServerEnv: () => {} };
});
vi.mock("@/lib/authServer", () => ({
  callerUserId: async () => "audit-user-1",
}));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: async () => false };
});
vi.mock("@/lib/socialOAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/socialOAuth")>();
  return {
    ...actual,
    createSocialOAuthStart: createSocialOAuthStartMock,
    socialProviderAvailability: () => {
      const base = actual.socialProviderAvailability();
      return {
        ...base,
        x: { ...base.x, oauth_identity: true },
      };
    },
  };
});

import { GET as versionGet } from "@/app/api/version/route";
import { POST as socialConnectPost } from "@/app/api/social-connections/[provider]/route";
import { PRODUCTION_SERVER_URL, nativeServerUrl } from "../capacitor.config";
import { localQaSupabaseConnectOrigins, supabaseCspOrigins } from "@/lib/supabaseCsp";
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

describe("explicit local production auth QA CSP", () => {
  const env = {
    NODE_ENV: "production",
    VERCEL_ENV: "development",
    PUBMAX_E2E_LOGIN: "1",
    VERCEL: "",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:58441",
    SUPABASE_URL: "http://127.0.0.1:58441",
  };
  afterEach(() => { vi.unstubAllEnvs(); });

  it.each([58441, 54321])("pins the genuine local API on port %i", (port) => {
    const url = `http://127.0.0.1:${port}`;
    expect(localQaSupabaseConnectOrigins({ ...env, NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_URL: url }, "http://127.0.0.1:32191/login")).toEqual([url, url.replace("http:", "ws:")]);
  });

  it("accepts matching literal localhost origins and a trailing slash", () => {
    expect(localQaSupabaseConnectOrigins({ ...env, NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321/", SUPABASE_URL: "http://localhost:54321" }, "http://localhost:3100/login")).toEqual(["http://localhost:54321", "ws://localhost:54321"]);
  });

  it.each([
    ["missing login opt-in", { PUBMAX_E2E_LOGIN: "" }],
    ["not the strict production runtime", { NODE_ENV: "development" }],
    ["missing development deployment", { VERCEL_ENV: "" }],
    ["deployed production", { VERCEL_ENV: "production" }],
    ["hosted Vercel process", { VERCEL: "1" }],
    ["public/server origin mismatch", { SUPABASE_URL: "http://localhost:58441" }],
    ["missing server origin", { SUPABASE_URL: "" }],
    ["remote public host", { NEXT_PUBLIC_SUPABASE_URL: "http://example.com:58441" }],
    ["unsupported local API port", { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:58442", SUPABASE_URL: "http://127.0.0.1:58442" }],
    ["URL credentials", { NEXT_PUBLIC_SUPABASE_URL: "http://user@127.0.0.1:58441" }],
    ["URL query", { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:58441?next=remote" }],
    ["URL path", { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:58441/auth" }],
    ["numeric host alias", { NEXT_PUBLIC_SUPABASE_URL: "http://2130706433:58441" }],
  ] as const)("refuses %s", (_name, changed) => {
    expect(localQaSupabaseConnectOrigins({ ...env, ...changed }, "http://127.0.0.1:32191/login")).toEqual([]);
  });

  it.each([
    "https://pubmaxxing.com/login", "http://example.com:32191/login",
    "http://127.0.0.1.evil.example:32191/login", "http://user@127.0.0.1:32191/login",
    "http://2130706433:32191/login", "http://127.0.0.1:80/login",
  ])("refuses a nonlocal QA document: %s", (url) => {
    expect(localQaSupabaseConnectOrigins(env, url)).toEqual([]);
  });

  it("adds only exact connect origins to a strict local document", () => {
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    const csp = securityProxy(new NextRequest("http://127.0.0.1:32191/login")).headers.get("content-security-policy") ?? "";
    const connect = csp.split(";").find((part) => part.trim().startsWith("connect-src")) ?? "";
    const scripts = csp.split(";").find((part) => part.trim().startsWith("script-src")) ?? "";
    expect(connect).toContain(" http://127.0.0.1:58441");
    expect(connect).toContain(" ws://127.0.0.1:58441");
    expect(scripts).not.toContain("unsafe-eval");
    expect(scripts).toContain("nonce-");
    const images = csp.split(";").find((part) => part.trim().startsWith("img-src")) ?? "";
    expect(images).not.toContain("http://127.0.0.1:58441");
  });

  it("does not add loopback auth to a hosted production document", () => {
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    vi.stubEnv("VERCEL_ENV", "production");
    const csp = securityProxy(new NextRequest("https://pubmaxxing.com/login")).headers.get("content-security-policy") ?? "";
    expect(csp).not.toContain("127.0.0.1:58441");
    expect(csp).not.toContain("unsafe-eval");
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

  it("returns the deployment id and hides build metadata from anonymous callers", async () => {
    process.env.CRON_SECRET = "cron-test-secret";
    process.env.PUBMAX_BUILD_COMMIT_SHA = "abc";
    const response = versionGet();
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body).toHaveProperty("deploymentId");
    expect(body).not.toHaveProperty("gitCommitSha");
    expect(body).not.toHaveProperty("gitCommitShaSource");
    expect(body).not.toHaveProperty("builtAt");
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
  afterEach(() => {
    createSocialOAuthStartMock.mockReset();
  });

  it("returns the house envelope when OAuth start throws", async () => {
    const secretDetail = "upstream-oauth-secret-detail-9f3a";
    createSocialOAuthStartMock.mockRejectedValue(new Error(secretDetail));

    const response = await socialConnectPost(
      new Request("http://localhost/api/social-connections/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "oauth" }),
      }),
      { params: Promise.resolve({ provider: "x" }) },
    );

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({
      error: "OAuth is unavailable.",
      code: "SOCIAL_PROVIDER_UNAVAILABLE",
      retryable: true,
    });
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(secretDetail);
  });
});
