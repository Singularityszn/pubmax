import { describe, expect, it } from "vitest";

import { loadWhatsOnTonight } from "@/components/map/useWhatsOnTonight";
import type { WhatsOnRow } from "@/lib/whatsOn";

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as unknown as Response;
}

const validRow: WhatsOnRow = {
  id: "r1",
  venueId: "v1",
  placeName: "The Test Arms",
  kind: "quiz",
  startsAt: "2026-07-12T19:00:00.000Z",
  title: "Quiz night",
  source: { label: "Org", url: "https://example.com" },
  observedAt: "2026-07-12T09:00:00.000Z",
  confidence: "listed",
};

describe("loadWhatsOnTonight (W1 primary-spine loader)", () => {
  it("returns ready with validated rows on a good response", async () => {
    const result = await loadWhatsOnTonight({
      fetchImpl: async () =>
        jsonResponse({ rows: [validRow, { junk: true }], asOf: "2026-07-12T10:00:00.000Z" }),
    });
    expect(result.status).toBe("ready");
    expect(result.rows).toHaveLength(1);
    expect(result.asOf).toBe("2026-07-12T10:00:00.000Z");
  });

  it("returns empty (not error) when the spine is up but quiet", async () => {
    const result = await loadWhatsOnTonight({
      fetchImpl: async () => jsonResponse({ rows: [], asOf: "2026-07-12T10:00:00.000Z" }),
    });
    expect(result.status).toBe("empty");
  });

  it("returns error on a non-OK response — an outage, not a quiet night", async () => {
    const result = await loadWhatsOnTonight({
      fetchImpl: async () => jsonResponse({ error: "boom" }, false),
    });
    expect(result.status).toBe("error");
    expect(result.rows).toHaveLength(0);
  });

  it("returns error for the route's fail-soft HTTP 200 envelope", async () => {
    const result = await loadWhatsOnTonight({
      fetchImpl: async () =>
        jsonResponse({
          rows: [],
          asOf: "2026-07-12T10:00:00.000Z",
          error: "Store unavailable",
        }),
    });
    expect(result.status).toBe("error");
    expect(result.rows).toEqual([]);
    expect(result.asOf).toBe("2026-07-12T10:00:00.000Z");
  });

  it("returns error when fetch throws", async () => {
    const result = await loadWhatsOnTonight({
      fetchImpl: async () => {
        throw new Error("network down");
      },
    });
    expect(result.status).toBe("error");
  });

  it("aborts a hung request after the timeout and returns error", async () => {
    const result = await loadWhatsOnTonight({
      timeoutMs: 20,
      fetchImpl: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    });
    expect(result.status).toBe("error");
  });
});
