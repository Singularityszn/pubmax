import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";

import { describe, expect, it, vi } from "vitest";

import {
  createFirecrawlClient,
  createHarvestBudget,
  firecrawlApiKey,
  HARVEST_CRON_REQUEST_BUDGET,
  HARVEST_MAX_ATTEMPTS,
  isFirecrawlConfigured,
  type FirecrawlClient,
} from "@/lib/harvest/firecrawl";

const noSleep = async () => {};

function okScrape(markdown: string, metadata: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ success: true, data: { markdown, metadata } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("firecrawl key configuration", () => {
  it("reads the key from the environment and trims it", () => {
    expect(firecrawlApiKey({ FIRECRAWL_API_KEY: "  fc-abc  " } as unknown as NodeJS.ProcessEnv)).toBe("fc-abc");
    expect(isFirecrawlConfigured({ FIRECRAWL_API_KEY: "fc-abc" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it("treats an absent or blank key as not configured", () => {
    expect(firecrawlApiKey({} as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(firecrawlApiKey({ FIRECRAWL_API_KEY: "   " } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(isFirecrawlConfigured({ FIRECRAWL_API_KEY: "" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("fail closed without a key", () => {
  it("returns no client, so a caller cannot fetch by accident", () => {
    const fetchImpl = vi.fn();
    const client = createFirecrawlClient({ env: {} as unknown as NodeJS.ProcessEnv, fetchImpl });
    expect(client).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not fall back to an unauthenticated request", () => {
    const fetchImpl = vi.fn();
    expect(
      createFirecrawlClient({ env: { FIRECRAWL_API_KEY: "  " } as unknown as NodeJS.ProcessEnv, fetchImpl }),
    ).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("per-run request budget", () => {
  it("counts down and refuses past the ceiling", () => {
    const budget = createHarvestBudget(2);
    expect(budget.limit).toBe(2);
    expect(budget.take()).toBe(true);
    expect(budget.take()).toBe(true);
    expect(budget.take()).toBe(false);
    expect(budget.spent()).toBe(2);
    expect(budget.remaining()).toBe(0);
  });

  it("treats a non-positive limit as no requests at all", () => {
    const budget = createHarvestBudget(0);
    expect(budget.take()).toBe(false);
    expect(createHarvestBudget(-5).take()).toBe(false);
  });

  it("stops sending once the run budget is spent, and says so", async () => {
    const fetchImpl = vi.fn(async () => okScrape("# page"));
    const client = createFirecrawlClient({
      apiKey: "fc-test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      budget: createHarvestBudget(2),
      sleepImpl: noSleep,
    });
    expect(client).not.toBeNull();

    await client!.scrape("https://example.com/one");
    await client!.scrape("https://example.com/two");
    const third = await client!.scrape("https://example.com/three");

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(third.ok).toBe(false);
    if (third.ok) throw new Error("expected the third scrape to be refused");
    expect(third.failure.reason).toBe("budget-exhausted");
    expect(third.failure.url).toBe("https://example.com/three");
  });

  it("charges retries to the budget, so a retry storm cannot outspend the cap", async () => {
    const fetchImpl = vi.fn(async () => new Response("busy", { status: 429 }));
    const budget = createHarvestBudget(2);
    const client = createFirecrawlClient({
      apiKey: "fc-test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      budget,
      sleepImpl: noSleep,
    });

    const outcome = await client!.scrape("https://example.com/rate-limited");

    // Two attempts is all the budget allowed, even though three are permitted.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(budget.remaining()).toBe(0);
    expect(outcome.ok).toBe(false);
  });

  it("shares one budget across scrape and search", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/search")
        ? new Response(JSON.stringify({ success: true, data: { web: [{ url: "https://a.example" }] } }), { status: 200 })
        : okScrape("# page"),
    );
    const budget = createHarvestBudget(3);
    const client = createFirecrawlClient({
      apiKey: "fc-test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      budget,
      sleepImpl: noSleep,
    });

    await client!.search("a pub");
    await client!.scrape("https://a.example");
    expect(budget.spent()).toBe(2);
    await client!.search("another pub");
    const refused = await client!.scrape("https://b.example");
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("expected refusal");
    expect(refused.failure.reason).toBe("budget-exhausted");
  });

  it("keeps the scheduled ceiling small enough that a cron cannot burn the account", () => {
    expect(HARVEST_CRON_REQUEST_BUDGET).toBeGreaterThan(0);
    expect(HARVEST_CRON_REQUEST_BUDGET).toBeLessThanOrEqual(25);
  });
});

describe("bounded retries", () => {
  it("retries a 5xx up to the attempt ceiling, then reports the failure", async () => {
    const fetchImpl = vi.fn(async () => new Response("boom", { status: 503 }));
    const client = createFirecrawlClient({
      apiKey: "fc-test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      budget: createHarvestBudget(20),
      sleepImpl: noSleep,
    });

    const outcome = await client!.scrape("https://example.com/down");

    expect(fetchImpl).toHaveBeenCalledTimes(HARVEST_MAX_ATTEMPTS);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected a failure");
    expect(outcome.failure.reason).toBe("http-error");
    expect(outcome.failure.status).toBe(503);
    expect(outcome.failure.attempts).toBe(HARVEST_MAX_ATTEMPTS);
  });

  it("does not retry a 4xx that is the source's own answer", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 403 }));
    const client = createFirecrawlClient({
      apiKey: "fc-test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      budget: createHarvestBudget(20),
      sleepImpl: noSleep,
    });

    const outcome = await client!.scrape("https://example.com/forbidden");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected a failure");
    expect(outcome.failure.status).toBe(403);
  });

  it("succeeds on a retry after a transient network error", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("socket hang up");
      return okScrape("# recovered", { statusCode: 200, cacheState: "miss" });
    });
    const client = createFirecrawlClient({
      apiKey: "fc-test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      budget: createHarvestBudget(20),
      sleepImpl: noSleep,
    });

    const outcome = await client!.scrape("https://example.com/flaky");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected a page");
    expect(outcome.page.markdown).toBe("# recovered");
    expect(outcome.page.cacheState).toBe("miss");
    expect(calls).toBe(2);
  });

  it("reports where Firecrawl landed after a redirect, and null when it does not say", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const asked = JSON.parse(String(init?.body)).url as string;
      return asked.endsWith("/moved")
        ? okScrape("# landed", { statusCode: 200, sourceURL: asked, url: "https://elsewhere.example/landing" })
        : okScrape("# stayed", { statusCode: 200 });
    });
    const client = createFirecrawlClient({
      apiKey: "fc-test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      budget: createHarvestBudget(20),
      sleepImpl: noSleep,
    });

    const moved = await client!.scrape("https://example.com/moved");
    if (!moved.ok) throw new Error("expected a page");
    expect(moved.page.url).toBe("https://example.com/moved");
    expect(moved.page.landedUrl).toBe("https://elsewhere.example/landing");
    const stayed = await client!.scrape("https://example.com/stayed");
    if (!stayed.ok) throw new Error("expected a page");
    expect(stayed.page.landedUrl).toBeNull();
  });

  it("refuses a success envelope carrying no markdown rather than inventing a page", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: { markdown: "   " } }), { status: 200 }),
    );
    const client = createFirecrawlClient({
      apiKey: "fc-test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      budget: createHarvestBudget(20),
      sleepImpl: noSleep,
    });

    const outcome = await client!.scrape("https://example.com/blank");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected a failure");
    expect(outcome.failure.reason).toBe("empty-body");
    // Not retried: an empty body is an answer, not a hiccup.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("sends the key as a bearer token and asks only for markdown", async () => {
    const fetchImpl = vi.fn(async () => okScrape("# page"));
    const client = createFirecrawlClient({
      apiKey: "fc-secret",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      budget: createHarvestBudget(5),
      sleepImpl: noSleep,
    });

    await client!.scrape("https://example.com/one", { maxAgeMs: 0 });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/scrape");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer fc-secret");
    const body = JSON.parse(String(init.body));
    expect(body.formats).toEqual(["markdown"]);
    expect(body.maxAge).toBe(0);
  });
});

describe("request deadlines", () => {
  it.each(["scrape", "search"] as const)("%s returns a timeout when a transport ignores its aborted signal", async (method) => {
    let signal: AbortSignal | undefined;
    let release!: (response: Response) => void;
    const fetchImpl: typeof fetch = async (_input, init) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((resolve) => { release = resolve; });
    };
    const budget = createHarvestBudget(1);
    const client = createFirecrawlClient({
      apiKey: "fc-test", fetchImpl, budget, maxAttempts: 1, timeoutMs: 10,
    })!;
    const pending = client[method]("https://example.com/stalled");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const outcome = await Promise.race([
        pending,
        new Promise<"deadline-missed">((resolve) => {
          timer = setTimeout(() => resolve("deadline-missed"), 250);
        }),
      ]);
      expect(outcome).not.toBe("deadline-missed");
      if (outcome === "deadline-missed" || outcome.ok) throw new Error("expected a timeout");
      expect(outcome.failure.reason).toBe("timeout");
      expect(outcome.failure.attempts).toBe(1);
      expect(signal?.aborted).toBe(true);
      expect(budget.spent()).toBe(1);
    } finally {
      clearTimeout(timer);
      release(okScrape("# late response"));
      await pending;
    }
  });

  it("covers stalled response decoding with the same deadline", async () => {
    let signal: AbortSignal | undefined;
    let release!: () => void;
    const response = okScrape("# late body");
    const originalJson = response.json.bind(response);
    response.json = async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return originalJson();
    };
    const fetchImpl: typeof fetch = async (_input, init) => {
      signal = init?.signal ?? undefined;
      return response;
    };
    const client = createFirecrawlClient({
      apiKey: "fc-test", fetchImpl, maxAttempts: 1, timeoutMs: 10,
    })!;
    const pending = client.scrape("https://example.com/stalled-body");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const outcome = await Promise.race([
        pending,
        new Promise<"deadline-missed">((resolve) => {
          timer = setTimeout(() => resolve("deadline-missed"), 250);
        }),
      ]);
      expect(outcome).not.toBe("deadline-missed");
      if (outcome === "deadline-missed" || outcome.ok) throw new Error("expected a timeout");
      expect(outcome.failure.reason).toBe("timeout");
      expect(signal?.aborted).toBe(true);
    } finally {
      clearTimeout(timer);
      release();
      await pending;
    }
  });

  it("retries a timed-out request and returns the recovered page", async () => {
    let calls = 0;
    let firstSignal: AbortSignal | undefined;
    const fetchImpl: typeof fetch = async (_input, init) => {
      calls += 1;
      if (calls > 1) return okScrape("# recovered after deadline");
      firstSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        firstSignal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    };
    const budget = createHarvestBudget(2);
    const client = createFirecrawlClient({
      apiKey: "fc-test", fetchImpl, budget, maxAttempts: 2, timeoutMs: 10, sleepImpl: noSleep,
    })!;
    const outcome = await client.scrape("https://example.com/recovered");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected a page");
    expect(outcome.page.markdown).toBe("# recovered after deadline");
    expect(firstSignal?.aborted).toBe(true);
    expect(budget.spent()).toBe(2);
  });

  it("refuses a timeout retry when the shared request budget is spent", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async (_input, init) => {
      calls += 1;
      return new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    };
    const budget = createHarvestBudget(1);
    const client = createFirecrawlClient({
      apiKey: "fc-test", fetchImpl, budget, timeoutMs: 10, sleepImpl: noSleep,
    })!;
    const outcome = await client.search("a pub");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected a budget refusal");
    expect(outcome.failure.reason).toBe("budget-exhausted");
    expect(outcome.failure.attempts).toBe(1);
    expect(budget.spent()).toBe(1);
    expect(calls).toBe(1);
  });

});

type LocalHandler = (req: IncomingMessage, res: ServerResponse) => void;

type LocalFirecrawl = {
  apiBase: string;
  requests: () => number;
  socketClosed: (request: number) => Promise<void>;
};

// A disposable Firecrawl stand-in on 127.0.0.1, answered by native fetch. Each
// request takes the next handler in order; a request past the list gets a 500.
async function withLocalFirecrawl(handlers: LocalHandler[], run: (server: LocalFirecrawl) => Promise<void>) {
  const closed = new Map<Socket, Promise<void>>();
  const requestSockets: Socket[] = [];
  const server = createServer((req, res) => {
    requestSockets.push(req.socket);
    const handler = handlers[requestSockets.length - 1];
    if (handler) handler(req, res);
    else res.writeHead(500).end();
  });
  server.on("connection", (socket: Socket) => {
    closed.set(socket, new Promise<void>((resolve) => socket.once("close", () => resolve())));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    await run({
      apiBase: `http://127.0.0.1:${port}/v2`,
      requests: () => requestSockets.length,
      socketClosed: (request) => {
        const socket = requestSockets[request];
        if (!socket) return Promise.reject(new Error(`request ${request} never reached the server`));
        return closed.get(socket)!;
      },
    });
  } finally {
    for (const socket of closed.keys()) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function within<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} took longer than ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const LOCAL_DEADLINE_MS = 750;
const LOCAL_WAIT_MS = 10_000;

const stallHeaders: LocalHandler = () => {};

const stallBody: LocalHandler = (_req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.write('{"success":true,"data":');
};

const unavailable: LocalHandler = (_req, res) => {
  res.writeHead(503).end();
};

const scrapeSucceeds: LocalHandler = (_req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ success: true, data: { markdown: "# recovered over http" } }));
};

describe("request deadlines against a local HTTP server", () => {
  it.each([
    ["scrape", "headers", stallHeaders],
    ["scrape", "body", stallBody],
    ["search", "headers", stallHeaders],
    ["search", "body", stallBody],
  ] as const)("%s times out a stalled %s and closes the socket", async (method, _stage, handler) => {
    await withLocalFirecrawl([handler], async (server) => {
      const budget = createHarvestBudget(1);
      const client = createFirecrawlClient({
        apiKey: "fc-dummy", apiBase: server.apiBase, budget, maxAttempts: 1, timeoutMs: LOCAL_DEADLINE_MS,
      })!;
      const pending: ReturnType<FirecrawlClient["scrape" | "search"]> =
        method === "scrape" ? client.scrape("https://example.com/stalled") : client.search("a stalled pub");
      const outcome = await within<Awaited<typeof pending>>(pending, LOCAL_WAIT_MS, `${method} deadline`);
      if (outcome.ok) throw new Error("expected a timeout");
      expect(outcome.failure.reason).toBe("timeout");
      expect(outcome.failure.attempts).toBe(1);
      expect(server.requests()).toBe(1);
      expect(budget.spent()).toBe(1);
      await within(server.socketClosed(0), LOCAL_WAIT_MS, "stalled socket close");
    });
  });

  it("retries a stalled body and a 503 within the shared budget, then refuses the next call", async () => {
    await withLocalFirecrawl([stallBody, unavailable, scrapeSucceeds], async (server) => {
      const budget = createHarvestBudget(3);
      const client = createFirecrawlClient({
        apiKey: "fc-dummy", apiBase: server.apiBase, budget, maxAttempts: 3, timeoutMs: LOCAL_DEADLINE_MS, sleepImpl: noSleep,
      })!;
      const outcome = await within(client.scrape("https://example.com/recovered"), LOCAL_WAIT_MS, "scrape recovery");
      if (!outcome.ok) throw new Error(`expected a page, got ${outcome.failure.reason}`);
      expect(outcome.page.markdown).toBe("# recovered over http");
      expect(server.requests()).toBe(3);
      expect(budget.spent()).toBe(3);
      await within(server.socketClosed(0), LOCAL_WAIT_MS, "stalled socket close");

      const refused = await client.search("a later pub");
      if (refused.ok) throw new Error("expected a budget refusal");
      expect(refused.failure.reason).toBe("budget-exhausted");
      expect(refused.failure.attempts).toBe(0);
      expect(server.requests()).toBe(3);
    });
  });
});
