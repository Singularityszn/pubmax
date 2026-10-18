// THE CDN DOCUMENTS ANSWER WITHOUT A FUNCTION, AND THEIR POLICY IS ONE POLICY.
//
// F1 item 3 of the Vercel insights read (15 Oct 2026): `/`, `/map`,
// `/tonight`, `/today` and `/near` were `x-vercel-cache: HIT` with no nonce,
// yet every request still ran proxy.ts and clerkMiddleware in front of the
// cache. The matcher now leaves them out on the canonical host, keeps the
// proxy only on the queries it acts on (the poster QR landing and the /map
// document twin), and next.config.mjs ships the same policy from `headers()`.
// lib/cdnDocumentEdge.mjs explains the rule; this file holds every copy of it
// to every other.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CDN_EDGE_DOCUMENT_PATHS,
  CDN_EDGE_PROXY_QUERY_KEYS,
  cdnEdgeHeaderRules,
  cdnEdgeMatcherAlternatives,
  cdnEdgeProxyMatchers,
} from "@/lib/cdnDocumentEdge.mjs";
import { cdnDocumentContentSecurityPolicy } from "@/lib/contentSecurityPolicy.mjs";
import { MAP_DOCUMENT_QUERY_KEYS } from "@/lib/mapDocumentTwin";
import { CDN_CACHED_DOCUMENT_PATHS, config } from "@/proxy";

const ROOT = process.cwd();
const CANONICAL = "https://pubmaxxing.com";
const PREVIEW = "https://pubmax-preview.vercel.app";
// The captain's development instance key (a PUBLISHABLE key, safe to commit),
// the same one __tests__/clerkProxyCsp.test.ts uses.
const PUBLISHABLE_KEY = "pk_test_cmFyZS10cm91dC0yOS5jbGVyay5hY2NvdW50cy5kZXYk";
const SUPABASE_URL = "https://abcdefghijklmnop.supabase.co";

function matches(url: string, headers?: Record<string, string>): boolean {
  return unstable_doesMiddlewareMatch({
    config,
    url,
    headers: { host: new URL(url).host, ...headers },
  });
}

type HeaderRule = {
  source: string;
  has?: Array<{ type: string; key: string; value?: string }>;
  missing?: Array<{ type: string; key: string; value?: string }>;
  headers: Array<{ key: string; value: string }>;
};

/** next.config.mjs's headers(), evaluated in a clean Node with this env. */
function configHeaders(env: Record<string, string>): HeaderRule[] {
  const out = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "const m = await import(process.argv[1]);" +
        "console.log(JSON.stringify(await m.default.headers()));",
      join(ROOT, "next.config.mjs"),
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        NODE_ENV: "production",
        ...env,
      },
    },
  );
  return JSON.parse(out) as HeaderRule[];
}

function cspRules(rules: HeaderRule[]): HeaderRule[] {
  return rules.filter((rule) =>
    rule.headers.some((header) => header.key.toLowerCase() === "content-security-policy"),
  );
}

/** The general matcher entry, the one that claims ordinary paths. */
function generalMatcherSource(): string {
  const entry = config.matcher.find(
    (rule) =>
      typeof rule === "object" &&
      typeof rule.source === "string" &&
      rule.source.includes("_next/static"),
  );
  if (!entry || typeof entry === "string") throw new Error("general matcher rule is gone");
  return entry.source;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("the CDN documents on the canonical host", () => {
  it("never run the proxy for a plain request", () => {
    for (const path of CDN_EDGE_DOCUMENT_PATHS) {
      expect(matches(`${CANONICAL}${path}`), path).toBe(false);
      // A query the proxy does not act on changes nothing: `?sel=` moves the
      // map camera after load, and a campaign tag is read by the client.
      expect(matches(`${CANONICAL}${path}?sel=venue-1&utm_source=x`), path).toBe(false);
    }
  });

  it("still run the proxy for the poster landing and every /map twin key", () => {
    expect(matches(`${CANONICAL}/?src=poster`)).toBe(true);
    expect(matches(`${CANONICAL}/?src=poster&utm_campaign=soho`)).toBe(true);
    for (const key of MAP_DOCUMENT_QUERY_KEYS) {
      expect(matches(`${CANONICAL}/map?${key}=x`), key).toBe(true);
    }
  });

  it("keeps the trailing-slash 308 and every other document on the proxy", () => {
    for (const path of ["/map/", "/tonight/", "/near/", "/login", "/u/you", "/places", "/map/london", "/nearby", "/todays", "/plan/0f8b7d2e-3c4a-4b5d-8e6f-1a2b3c4d5e6f", "/pal/chat", "/planner", "/palette"]) {
      expect(matches(`${CANONICAL}${path}`), path).toBe(true);
    }
  });

  it("still run the proxy on a generated or preview host", () => {
    for (const path of CDN_EDGE_DOCUMENT_PATHS) {
      expect(matches(`${PREVIEW}${path}`), path).toBe(true);
    }
  });
});

describe("one list, held in every place it is written", () => {
  it("is the list proxy.ts prices the nonce exception for", () => {
    expect(new Set(CDN_EDGE_DOCUMENT_PATHS)).toEqual(CDN_CACHED_DOCUMENT_PATHS);
  });

  it("is the alternation proxy.ts's general matcher literal excludes", () => {
    expect(generalMatcherSource()).toContain(`|${cdnEdgeMatcherAlternatives()})`);
  });

  it("is the set of query matchers proxy.ts writes out", () => {
    for (const entry of cdnEdgeProxyMatchers()) {
      expect(config.matcher, JSON.stringify(entry)).toContainEqual(entry);
    }
  });

  it("names the keys the proxy reads on those paths", () => {
    expect(CDN_EDGE_PROXY_QUERY_KEYS["/map"]).toEqual(MAP_DOCUMENT_QUERY_KEYS);
    expect(Object.keys(CDN_EDGE_PROXY_QUERY_KEYS).sort()).toEqual(["/", "/map"]);
    const proxySource = readFileSync(join(ROOT, "proxy.ts"), "utf8");
    expect(proxySource).toContain('pathname === "/" && isPosterLandingSrc(request.nextUrl.searchParams.get("src"))');
  });
});

describe("the static policy is the policy the proxy would have sent", () => {
  const envs: Array<[string, Record<string, string>]> = [
    ["no Clerk and no Supabase", {}],
    [
      "Clerk and Supabase configured",
      {
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
        NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
      },
    ],
  ];

  it.each(envs)("with %s", async (_label, env) => {
    const rules = cspRules(configHeaders(env));
    expect(rules).toEqual(cdnEdgeHeaderRules(cdnDocumentContentSecurityPolicy({ NODE_ENV: "production", ...env })));

    vi.stubEnv("NODE_ENV", "production");
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    vi.resetModules();
    const { securityProxy } = await import("@/proxy");

    for (const rule of rules) {
      const response = securityProxy(
        new NextRequest(`${CANONICAL}${rule.source}`, {
          headers: { host: "pubmaxxing.com", accept: "text/html" },
        }),
      );
      const proxyPolicy = response.headers.get("Content-Security-Policy");
      expect(proxyPolicy, rule.source).toBe(rule.headers[0]?.value);
      expect(proxyPolicy, rule.source).toContain("'unsafe-inline'");
      expect(proxyPolicy, rule.source).not.toContain("'nonce-");
    }
  });

  it("stays off every request the proxy still answers", () => {
    const byPath = new Map(cspRules(configHeaders({})).map((rule) => [rule.source, rule]));
    expect([...byPath.keys()].sort()).toEqual([...CDN_EDGE_DOCUMENT_PATHS].sort());
    expect(byPath.get("/")?.missing).toEqual([{ type: "query", key: "src" }]);
    expect(byPath.get("/map")?.missing).toEqual(
      MAP_DOCUMENT_QUERY_KEYS.map((key) => ({ type: "query", key })),
    );
    for (const path of ["/tonight", "/today", "/near"]) {
      expect(byPath.get(path)?.missing, path).toBeUndefined();
      expect(byPath.get(path)?.has, path).toBeUndefined();
    }
  });
});
