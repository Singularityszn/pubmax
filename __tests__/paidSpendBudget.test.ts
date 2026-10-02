// A ceiling no header can widen (thermonuclear review P1-3).
//
// The route case at the bottom is the one the acceptance line names: 200
// requests carrying 200 DISTINCT `x-forwarded-for` values, which the per-address
// limiter can never refuse because each value is its own bucket, and which the
// deployment ceiling refuses the moment it is spent.

import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/serverEnv")>()),
  assertProductionSecrets: () => {},
}));

vi.mock("@/lib/ask/runAsk", () => ({
  runAsk: vi.fn(async () => ({ answer: "A quiet one.", citations: [], tools: [] })),
}));

import { POST as ASK_POST } from "@/app/api/ask/route";
import {
  PAID_SPEND_BUDGET_WINDOW_MS,
  PAID_SPEND_DEFAULT_DAILY_BUDGET,
  PAID_SPEND_LANES,
  PAID_SPEND_REFUSAL_CODE,
  PAID_SPEND_REFUSAL_LINE,
  paidSpendBudgetEnvName,
  paidSpendBudgetKey,
  paidSpendDailyBudget,
  type PaidSpendLane,
} from "@/lib/paidSpendBudget";
import { __resetPintDrops } from "@/lib/pintDrops";

const ROOT = process.cwd();

// The file that owns each lane's consumption. A paid route that stops calling
// the seam fails here rather than quietly spending again.
const LANE_OWNERS: Record<PaidSpendLane, string> = {
  ask: "app/api/ask/route.ts",
  heritage: "app/api/heritage/route.ts",
  "pub-pal-llm": "app/api/pub-pal/llm/route.ts",
  "plan-generate": "lib/planGeneration.server.ts",
  typesafe: "lib/ai/typesafe.server.ts",
};

const PAID_HOSTS = new Set(["openrouter.ai", "api.elevenlabs.io", "api.typesafe.ai"]);

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

function paidHostsCalled(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls
    .map(([input]) => new URL(input instanceof Request ? input.url : String(input)).hostname)
    .filter((host) => PAID_HOSTS.has(host));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the budget key", () => {
  it("names the lane and nothing a caller controls", () => {
    for (const lane of PAID_SPEND_LANES) {
      const key = paidSpendBudgetKey(lane);
      expect(key).toBe(`paid-spend:${lane}`);
      // No address, no account, no day stamp: anything here that varies per
      // caller would be a budget the caller chose, which is the whole defect.
      expect(key).not.toMatch(/[0-9a-f]{64}/);
      expect(key).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });

  it("gives every lane its own key, so one lane cannot starve another", () => {
    const keys = new Set(PAID_SPEND_LANES.map(paidSpendBudgetKey));
    expect(keys.size).toBe(PAID_SPEND_LANES.length);
  });

  it("covers a rolling day rather than a calendar one", () => {
    expect(PAID_SPEND_BUDGET_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe("the ceiling", () => {
  it("ships a positive default for every lane", () => {
    for (const lane of PAID_SPEND_LANES) {
      expect(PAID_SPEND_DEFAULT_DAILY_BUDGET[lane]).toBeGreaterThan(0);
      expect(paidSpendDailyBudget(lane, {})).toBe(PAID_SPEND_DEFAULT_DAILY_BUDGET[lane]);
    }
  });

  it("is operable from the environment, and zero closes one lane", () => {
    expect(paidSpendBudgetEnvName("pub-pal-llm")).toBe("PUBMAX_PAID_SPEND_BUDGET_PUB_PAL_LLM");
    expect(paidSpendDailyBudget("ask", { PUBMAX_PAID_SPEND_BUDGET_ASK: "25" })).toBe(25);
    expect(paidSpendDailyBudget("ask", { PUBMAX_PAID_SPEND_BUDGET_ASK: "0" })).toBe(0);
  });

  it("keeps the default when an override is not an instruction", () => {
    for (const raw of ["", "  ", "lots", "-1", "12.5", "1e3"]) {
      expect(paidSpendDailyBudget("ask", { PUBMAX_PAID_SPEND_BUDGET_ASK: raw }), raw).toBe(
        PAID_SPEND_DEFAULT_DAILY_BUDGET.ask,
      );
    }
  });
});

describe("lane coverage", () => {
  it("has every paid lane consuming the ceiling in its own file", () => {
    for (const lane of PAID_SPEND_LANES) {
      const source = readFileSync(path.join(ROOT, LANE_OWNERS[lane]), "utf8");
      expect(source, LANE_OWNERS[lane]).toContain(`paidSpendBudgetRefusal("${lane}")`);
    }
  });

});

describe("a paid route called without a session", () => {
  let paidFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __resetPintDrops();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    for (const lane of PAID_SPEND_LANES) vi.stubEnv(paidSpendBudgetEnvName(lane), "0");
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
    vi.stubEnv("TYPESAFE_API_KEY", "test-typesafe-key");
    vi.stubEnv("ELEVENLABS_API_KEY", "test-elevenlabs-key");
    vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "test-agent");
    vi.stubEnv("ELEVENLABS_LLM_SHARED_SECRET", "test-shared-secret");
    paidFetch = vi.fn(async () => new Response("{}", { status: 503 }));
    vi.stubGlobal("fetch", paidFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(PAID_ROUTES)("$route refuses before any paid call", async ({ call, refusal }) => {
    const response = await call();

    expect(response.status).toBe(refusal.status);
    expect(await response.json()).toMatchObject(refusal.body);
    expect(paidHostsCalled(paidFetch)).toEqual([]);
  });

  it.each(KNOWN_UNGUARDED_ANONYMOUS_PAID_ROUTES)(
    "$route still reaches a paid host until $owner closes it",
    async ({ call }) => {
      await call();

      expect(paidHostsCalled(paidFetch)).not.toEqual([]);
    },
  );
});

describe("POST /api/ask under a spent deployment ceiling", () => {
  const BUDGET = 5;
  const REQUESTS = 200;

  beforeEach(() => {
    // One budget per case: the in-memory limiter is module state, so without
    // this the second case starts with the first case's ceiling already spent.
    __resetPintDrops();
    // Keyless: no Supabase, so the shared limiter uses its in-memory budget.
    // That is the same code path a deployment takes through the durable RPC,
    // and it is what makes this a route test rather than a mock assertion.
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.OPENROUTER_API_KEY;
    vi.stubEnv("PUBMAX_PAID_SPEND_BUDGET_ASK", String(BUDGET));
  });

  it("refuses once the ceiling is spent, however many addresses the caller invents", async () => {
    const statuses: number[] = [];
    const codes: (string | undefined)[] = [];

    for (let index = 0; index < REQUESTS; index += 1) {
      // A distinct, well-formed address on every request. Under the old
      // reading this bought a fresh 10-per-minute budget each time.
      const address = `203.0.113.${index % 256}`;
      const suffix = Math.floor(index / 256);
      const response = await ASK_POST(
        new Request("http://localhost/api/ask", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": suffix ? `198.51.100.1, ${address}` : address,
          },
          body: JSON.stringify({ query: `Where is a quiet pint ${index}` }),
        }),
      );
      statuses.push(response.status);
      const body = (await response.json()) as { code?: string; error?: string };
      codes.push(body.code);
    }

    // The ceiling let exactly BUDGET calls through and then closed.
    expect(statuses.slice(0, BUDGET)).toEqual(Array(BUDGET).fill(200));
    expect(statuses.slice(BUDGET)).toEqual(Array(REQUESTS - BUDGET).fill(429));

    // Every refusal is the DEPLOYMENT ceiling, never the per-address limiter:
    // 200 distinct addresses is 200 distinct per-address buckets, so that
    // limiter refused nobody. This is the defect and the fix in one assertion.
    expect(new Set(codes.slice(BUDGET))).toEqual(new Set([PAID_SPEND_REFUSAL_CODE]));
    expect(codes).not.toContain("RATE_LIMITED");
  });

  it("answers the same sentence to every refused caller", async () => {
    for (let index = 0; index < BUDGET + 2; index += 1) {
      const response = await ASK_POST(
        new Request("http://localhost/api/ask", {
          method: "POST",
          headers: { "content-type": "application/json", "x-real-ip": `192.0.2.${index}` },
          body: JSON.stringify({ query: "Where is a quiet pint" }),
        }),
      );
      if (index < BUDGET) continue;
      expect(response.status).toBe(429);
      expect(await response.json()).toEqual({
        error: PAID_SPEND_REFUSAL_LINE,
        code: PAID_SPEND_REFUSAL_CODE,
        retryable: true,
      });
    }
  });
});
