// No API route may spend a paid provider for a caller with no session unless
// the deployment ceiling stands in front of it (thermonuclear review P1-3).
//
// Every paid client in this app reaches its provider through the global fetch,
// so that fetch is the one mock: a call to a provider domain is a paid call,
// however its host is spelled in the source. Every provider key is set and
// every paid-spend ceiling is closed and every operator secret is configured as
// a deployment configures it, so a route that would spend for an anonymous
// caller does here.

import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PAID_SPEND_LANES,
  PAID_SPEND_REFUSAL_CODE,
  paidSpendBudgetEnvName,
} from "@/lib/paidSpendBudget";
import { __resetPintDrops } from "@/lib/pintDrops";

const ROOT = process.cwd();
const API_DIR = path.join(ROOT, "app", "api");

const PAID_PROVIDER_DOMAINS = [
  "openrouter.ai",
  "openai.com",
  "elevenlabs.io",
  "typesafe.ai",
  "tavily.com",
  "firecrawl.dev",
  "exa.ai",
  "context.dev",
  "places.googleapis.com",
  "nebius.ai",
  "nebius.com",
];

const PAID_PROVIDER_KEYS = [
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "ELEVENLABS_API_KEY",
  "TYPESAFE_API_KEY",
  "TAVILY_API_KEY",
  "FIRECRAWL_API_KEY",
  "EXA_API_KEY",
  "CONTEXT_DEV_API_KEY",
];

const HANDLER_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;

function routeFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) routeFiles(full, acc);
    else if (entry === "route.ts" || entry === "route.tsx") acc.push(path.relative(ROOT, full));
  }
  return acc.sort();
}

/** The params Next would hand a handler for one concrete URL of this route. */
function probeParams(route: string): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = {};
  for (const segment of path.dirname(route).split(path.sep)) {
    const catchAll = /^\[\[?\.\.\.(\w+)\]\]?$/.exec(segment);
    const single = /^\[(\w+)\]$/.exec(segment);
    if (catchAll) params[catchAll[1]] = ["probe"];
    else if (single) params[single[1]] = "probe";
  }
  return params;
}

function probeUrl(route: string): string {
  const pathname = path
    .dirname(route)
    .replace(/^app/, "")
    .split(path.sep)
    .map((segment) => (segment.startsWith("[") ? "probe" : segment))
    .join("/");
  return `http://localhost${pathname}`;
}

function anonymousRequest(route: string, method: string): Request {
  const hasBody = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  return new Request(probeUrl(route), {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
    ...(hasBody ? { body: "{}" } : {}),
  });
}

const API_ROUTES = routeFiles(API_DIR);

type PaidRouteCase = {
  route: string;
  call: () => Promise<Response>;
  refusal: { status: number; body: Record<string, unknown> };
};

function jsonPost(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
    body: JSON.stringify(body),
  });
}

function photoPost(url: string): Request {
  const form = new FormData();
  form.set("photo", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "pint.png", { type: "image/png" }));
  return new Request(url, {
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.7" },
    body: form,
  });
}

const params = <T,>(value: T) => ({ params: Promise.resolve(value) });

const UNAUTHENTICATED = { status: 401, body: { code: "UNAUTHENTICATED" } };
const CEILING_SPENT = { status: 429, body: { code: PAID_SPEND_REFUSAL_CODE } };
const SIGN_IN_TO_CONTRIBUTE = { status: 401, body: { status: "sign_in_required" } };
const SIGN_IN_AS_OWNER = { status: 403, body: { code: "FORBIDDEN" } };

/** Every route handler that can reach a paid provider, called with no session. */
const PAID_ROUTES: PaidRouteCase[] = [
  {
    route: "app/api/ask/route.ts",
    call: async () =>
      (await import("@/app/api/ask/route")).POST(
        jsonPost("http://localhost/api/ask", { query: "Where is a quiet pint" }),
      ),
    refusal: CEILING_SPENT,
  },
  {
    route: "app/api/heritage/route.ts",
    call: async () =>
      (await import("@/app/api/heritage/route")).POST(
        jsonPost("http://localhost/api/heritage", {
          venueName: "The Lamb",
          question: "How old is this pub?",
        }),
      ),
    refusal: CEILING_SPENT,
  },
  {
    route: "app/api/plans/generate/route.ts",
    call: async () =>
      (await import("@/app/api/plans/generate/route")).POST(
        jsonPost("http://localhost/api/plans/generate", { query: "A quiet crawl in Soho" }),
      ),
    refusal: CEILING_SPENT,
  },
  {
    route: "app/api/pub-pal/llm/route.ts",
    call: async () =>
      (await import("@/app/api/pub-pal/llm/route")).POST(
        jsonPost("http://localhost/api/pub-pal/llm", {
          messages: [{ role: "user", content: "Where is a quiet pint" }],
        }),
      ),
    refusal: UNAUTHENTICATED,
  },
  {
    route: "app/api/pub-pal/tools/[toolName]/route.ts",
    call: async () =>
      (await import("@/app/api/pub-pal/tools/[toolName]/route")).POST(
        jsonPost("http://localhost/api/pub-pal/tools/venue_heritage", {
          args: { venueName: "The Lamb" },
        }),
        params({ toolName: "venue_heritage" }),
      ),
    refusal: UNAUTHENTICATED,
  },
  {
    route: "app/api/pub-pal/tool-turn/route.ts",
    call: async () =>
      (await import("@/app/api/pub-pal/tool-turn/route")).POST(
        jsonPost("http://localhost/api/pub-pal/tool-turn", {
          conversationId: "conversation-1",
          query: "Where is a quiet pint",
        }),
      ),
    refusal: UNAUTHENTICATED,
  },
  {
    route: "app/api/pub-pal/voice-token/route.ts",
    call: async () =>
      (await import("@/app/api/pub-pal/voice-token/route")).POST(
        jsonPost("http://localhost/api/pub-pal/voice-token", {}),
      ),
    refusal: UNAUTHENTICATED,
  },
  {
    route: "app/api/drink-wall/route.ts",
    call: async () =>
      (await import("@/app/api/drink-wall/route")).POST(photoPost("http://localhost/api/drink-wall")),
    refusal: SIGN_IN_TO_CONTRIBUTE,
  },
  {
    route: "app/api/venue-photos/route.ts",
    call: async () =>
      (await import("@/app/api/venue-photos/route")).POST(photoPost("http://localhost/api/venue-photos")),
    refusal: SIGN_IN_TO_CONTRIBUTE,
  },
  {
    route: "app/api/profiles/[handle]/avatar/route.ts",
    call: async () =>
      (await import("@/app/api/profiles/[handle]/avatar/route")).POST(
        photoPost("http://localhost/api/profiles/someone/avatar"),
        params({ handle: "someone" }),
      ),
    refusal: SIGN_IN_AS_OWNER,
  },
  {
    route: "app/api/profiles/[handle]/cover/route.ts",
    call: async () =>
      (await import("@/app/api/profiles/[handle]/cover/route")).POST(
        photoPost("http://localhost/api/profiles/someone/cover"),
        params({ handle: "someone" }),
      ),
    refusal: SIGN_IN_AS_OWNER,
  },
  {
    route: "app/api/profiles/[handle]/covers/route.ts",
    call: async () =>
      (await import("@/app/api/profiles/[handle]/covers/route")).POST(
        photoPost("http://localhost/api/profiles/someone/covers"),
        params({ handle: "someone" }),
      ),
    refusal: SIGN_IN_AS_OWNER,
  },
  {
    route: "app/api/messages/[id]/route.ts",
    call: async () =>
      (await import("@/app/api/messages/[id]/route")).POST(
        jsonPost("http://localhost/api/messages/thread-1", {
          action: "send",
          handle: "someone",
          body: "A pint?",
        }),
        params({ id: "thread-1" }),
      ),
    refusal: UNAUTHENTICATED,
  },
];

/**
 * Anonymous paid routes that still skip the deployment ceiling, each with the
 * task that owns closing it. This list may only shrink: an entry that stops
 * spending without a session must be deleted.
 */
const KNOWN_UNGUARDED_ANONYMOUS_PAID_ROUTES: Array<{
  route: string;
  owner: string;
  call: () => Promise<Response>;
}> = [
  {
    route: "app/api/pub-pal/chat/route.ts",
    owner: "pubmax-sec-pubpal",
    call: async () =>
      (await import("@/app/api/pub-pal/chat/route")).POST(
        jsonPost("http://localhost/api/pub-pal/chat", { query: "Where is a quiet pint" }),
      ),
  },
];

function isPaidHost(host: string): boolean {
  return PAID_PROVIDER_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function paidHostsCalled(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls
    .map(([input]) => new URL(input instanceof Request ? input.url : String(input)).hostname)
    .filter(isPaidHost);
}


describe("an API route called without a session", () => {
  let paidFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __resetPintDrops();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    for (const lane of PAID_SPEND_LANES) vi.stubEnv(paidSpendBudgetEnvName(lane), "0");
    for (const key of PAID_PROVIDER_KEYS) vi.stubEnv(key, `test-${key.toLowerCase()}`);
    vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "test-agent");
    vi.stubEnv("ELEVENLABS_LLM_SHARED_SECRET", "test-shared-secret");
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
    vi.stubEnv("ADMIN_TOKEN", "test-admin-token");
    paidFetch = vi.fn(async () => new Response("{}", { status: 503 }));
    vi.stubGlobal("fetch", paidFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const excepted = new Set(KNOWN_UNGUARDED_ANONYMOUS_PAID_ROUTES.map(({ route }) => route));

  it.each(API_ROUTES.filter((route) => !excepted.has(route)))(
    "%s calls no paid provider",
    async (route) => {
      const handlers = (await import(/* @vite-ignore */ path.join(ROOT, route))) as Record<
        string,
        unknown
      >;
      for (const method of HANDLER_METHODS) {
        const handler = handlers[method];
        if (typeof handler !== "function") continue;
        await Promise.resolve()
          .then(() =>
            handler(anonymousRequest(route, method), { params: Promise.resolve(probeParams(route)) }),
          )
          .catch(() => undefined);
      }

      expect(paidHostsCalled(paidFetch)).toEqual([]);
    },
    30_000,
  );

  it.each(PAID_ROUTES)("$route refuses a real request before any paid call", async ({ route, call, refusal }) => {
    expect(API_ROUTES).toContain(route);

    const response = await call();

    expect(response.status).toBe(refusal.status);
    expect(await response.json()).toMatchObject(refusal.body);
    expect(paidHostsCalled(paidFetch)).toEqual([]);
  });

  it.each(KNOWN_UNGUARDED_ANONYMOUS_PAID_ROUTES)(
    "$route still reaches a paid provider until $owner closes it",
    async ({ route, call }) => {
      expect(API_ROUTES).toContain(route);

      await call();

      expect(paidHostsCalled(paidFetch)).not.toEqual([]);
    },
  );
});
