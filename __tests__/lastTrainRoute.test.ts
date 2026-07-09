import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/last-train/route";

const realFetch = global.fetch;

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  global.fetch = realFetch;
});

describe("GET /api/last-train", () => {
  it("400s when lat/lng are missing or invalid", async () => {
    const res = await GET(new Request("http://localhost/api/last-train"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "lat and lng are required numbers." });
  });

  it("returns live_data_unavailable gracefully when TfL StopPoint lookup fails", async () => {
    global.fetch = vi.fn(async () => new Response("service unavailable", { status: 503 }));

    const res = await GET(new Request("http://localhost/api/last-train?lat=51.5&lng=-0.12"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.station).toBeNull();
    expect(body.decision.decision).toBe("live_data_unavailable");
    expect(body.error).toMatch(/TfL/i);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("passes destination through without persisting it (session-only label)", async () => {
    global.fetch = vi.fn(async () => new Response("service unavailable", { status: 503 }));

    const res = await GET(
      new Request(
        "http://localhost/api/last-train?lat=51.5&lng=-0.12&destination=Home%20station",
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.decision.destinationLabel).toBe("Home station");
  });
});
