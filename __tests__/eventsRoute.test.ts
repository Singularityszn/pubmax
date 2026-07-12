import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/events/route";
import { __resetPintDrops } from "@/lib/pintDrops";

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/events", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

// Neutralize prod Supabase config so isEventsRateLimited always takes the
// deterministic in-memory path here — on Vercel, vitest runs under
// NODE_ENV=production with real SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY set,
// which would otherwise route these checks through the durable RPC limiter.
beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetPintDrops();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/events", () => {
  it("accepts a known event and logs a PII-free line, returning 204", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await POST(
      post(
        JSON.stringify({
          name: "tonight_filter_select",
          props: { kind: "gig", secret: "drop-me" },
          path: "/tonight?ref=x",
          ts: 123,
        }),
      ),
    );
    expect(res.status).toBe(204);
    expect(log).toHaveBeenCalledTimes(1);
    const line = log.mock.calls[0][0] as string;
    expect(line).toContain("[pubmax-analytics]");
    expect(line).toContain('"kind":"gig"');
    expect(line).not.toContain("secret");
    expect(line).not.toContain("drop-me");
    // path is coarsened — query dropped.
    expect(line).toContain('"path":"/tonight"');
    expect(line).not.toContain("ref=x");
  });

  it("silently drops an unknown event (204, no log)", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await POST(post(JSON.stringify({ name: "totally_made_up" })));
    expect(res.status).toBe(204);
    expect(log).not.toHaveBeenCalled();
  });

  it("fail-softs on malformed JSON without throwing", async () => {
    const res = await POST(post("{not json"));
    expect(res.status).toBe(204);
  });

  it("ignores an oversized body", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const huge = JSON.stringify({ name: "tonight_screen_view", props: { x: "y".repeat(5000) } });
    const res = await POST(post(huge));
    expect(res.status).toBe(204);
    expect(log).not.toHaveBeenCalled();
  });

  it("drops the 121st event from the same IP within a minute (204, no log)", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const body = JSON.stringify({ name: "tonight_screen_view" });
    const headers = { "x-forwarded-for": "203.0.113.9" };

    for (let i = 0; i < 120; i++) {
      const res = await POST(post(body, headers));
      expect(res.status).toBe(204);
    }
    expect(log).toHaveBeenCalledTimes(120);

    const overLimit = await POST(post(body, headers));
    expect(overLimit.status).toBe(204);
    expect(log).toHaveBeenCalledTimes(120); // 121st is rate-limited, never logged/recorded.
  });

  it("honors DNT: 1 server-side — no log even for a known event", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await POST(
      post(JSON.stringify({ name: "tonight_screen_view" }), { dnt: "1" }),
    );
    expect(res.status).toBe(204);
    expect(log).not.toHaveBeenCalled();
  });
});
