// Test-environment isolation.

import { afterEach, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

// NODE'S OWN WEB STORAGE SHADOWS jsdom's, AND ANSWERS undefined.
//
// Node 22 and later define a global `localStorage` accessor that reports
// undefined unless the process was started with `--localstorage-file`. In
// vitest's jsdom environment `window` IS `globalThis`, so under Node 26 that
// accessor sits where jsdom's own Storage should be: `window.sessionStorage` is
// a real Storage while `window.localStorage` reads undefined. Sixteen browser
// suites failed on their first `localStorage.clear()` that way, on a Node the
// engines field admits, and every one of them was green on the same commit
// under an older runtime.
//
// The restore runs ONCE, before any test, and only when jsdom is the
// environment and its Storage is missing. A suite that deliberately deletes or
// replaces localStorage still does so; nothing here puts it back.
function inMemoryWebStorage(): Storage {
  const items = new Map<string, string>();
  const storage: Storage = {
    get length(): number {
      return items.size;
    },
    key(index: number): string | null {
      return [...items.keys()][index] ?? null;
    },
    getItem(key: string): string | null {
      return items.get(String(key)) ?? null;
    },
    setItem(key: string, value: string): void {
      items.set(String(key), String(value));
    },
    removeItem(key: string): void {
      items.delete(String(key));
    },
    clear(): void {
      items.clear();
    },
  };
  return storage;
}

if (
  typeof window !== "undefined"
  && typeof window.sessionStorage !== "undefined"
  && typeof window.localStorage === "undefined"
) {
  Object.defineProperty(window, "localStorage", {
    value: inMemoryWebStorage(),
    configurable: true,
    writable: true,
  });
}

// vitest.config.mts creates this once per run and test.env distributes the same
// value to every worker. Some security tests intentionally delete or replace
// it; restore the worker baseline around every test so later route tests never
// become order-dependent. Never print or snapshot this value.
const VITEST_PLAN_SIGNING_SECRET = process.env.PLAN_IDEMPOTENCY_SECRET;
if (!VITEST_PLAN_SIGNING_SECRET) {
  throw new Error("Vitest signing harness was not initialized.");
}

function restoreVitestSigningSecret(): void {
  process.env.PLAN_IDEMPOTENCY_SECRET = VITEST_PLAN_SIGNING_SECRET;
}

beforeEach(restoreVitestSigningSecret);
afterEach(restoreVitestSigningSecret);

//
// `npm run ci` executes vitest inside Vercel's build pipeline, where the
// platform exports deployment env vars (VERCEL_ENV=production on Production
// builds, =preview on Previews). The unit tests are not a deployment: letting
// VERCEL_ENV leak into the test process makes environment guards
// (lib/serverEnv.ts isDeployedProduction, lib/supabase.ts
// requiresSupabaseStore) treat the test run as a live production runtime —
// keyless route tests then 503 and the Production build fails, while Preview
// builds pass. First seen on the first Production build after #272.
//
// Production builds also expose the server-side Supabase credentials. Unit
// route tests must not spend the shared production rate-limit budget (or
// become order-dependent when two Vercel projects build concurrently), so the
// test baseline strips those credentials as well. Integration tests that need
// a durable client provide explicit stub credentials in their own setup.
//
// Deleting these vars here keeps the production guards at full strength in
// real runtimes while tests exercise the documented keyless (memory-store)
// behaviour. Tests that assert guard behaviour stub the relevant variables
// explicitly via vi.stubEnv and are unaffected.
delete process.env.VERCEL_ENV;
delete process.env.VERCEL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

// Clerk uses the same two-key deployment gate. Production builds expose both
// keys before Vitest starts, but keyless tests must keep proving the fallback
// path. Tests for configured Clerk behaviour provide explicit stub values.
delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
delete process.env.CLERK_SECRET_KEY;

// Same trap, different flag: the Production Vercel project sets
// NEXT_PUBLIC_DEMO_CONTENT=off, and `npm run ci` runs vitest inside that
// build. Seed-behaviour tests (demoPintDropsForCity and friends) assume the
// documented default (demo content ON), so letting the deployment flag leak
// in turns them red on Production builds only — Previews (no flag) stay
// green. First seen when the flag was set on Production after #395.
//
// Strip it here so the test baseline is the documented default regardless of
// ambient env. Tests that assert the off behaviour stub the flag explicitly
// (see __tests__/demoContent.test.ts) and are unaffected.
delete process.env.NEXT_PUBLIC_DEMO_CONTENT;

// The demo DRINK gate is the opposite default (opt-in, #1427), so the same
// hermetic rule applies from the other side: a developer's local
// NEXT_PUBLIC_DEMO_DRINKS=on must not make the production-default tests pass.
delete process.env.NEXT_PUBLIC_DEMO_DRINKS;

// Same trap again for the cron freshness plane (#485): the Vercel build env
// carries real provider keys (EXA_API_KEY on Production), and the cron route
// tests assert the documented keyless default (skip + warn). Letting ambient
// keys leak in turns those tests red only inside Vercel builds. Strip every
// ingest/event provider key; tests that assert key-present behaviour stub
// them explicitly via vi.stubEnv and are unaffected.
delete process.env.EXA_API_KEY;
delete process.env.FIRECRAWL_API_KEY;
delete process.env.TICKETMASTER_API_KEY;
delete process.env.SKIDDLE_API_KEY;

// Search-provider tests own selection and spend limits. Keep their keyless
// baseline independent from deployment Gateway and Tavily configuration.
delete process.env.AI_GATEWAY_API_KEY;
delete process.env.VERCEL_OIDC_TOKEN;
delete process.env.TAVILY_API_KEY;
delete process.env.SEARCH_PROVIDER;
delete process.env.SEARCH_GATEWAY_MAX_CALLS;

// Same trap for the road-route plane: the walk-route provider (lib/walkRouteProvider.ts)
// routes crawl legs through OpenRouteService when ORS_API_KEY is present. The
// provider + route tests assert the documented keyless default (return null →
// straight-line fallback). A leaked Production key would flip them to the
// key-present path only inside Vercel builds. Key-present behaviour is proven
// with an explicit apiKey / vi.stubEnv.
delete process.env.ORS_API_KEY;
