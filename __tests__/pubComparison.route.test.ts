import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ catalogue: vi.fn(), compare: vi.fn(), limited: vi.fn() }));
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/pintDrops", () => ({ isLimited: reads.limited }));
vi.mock("@/lib/supabase", () => ({ clientIp: () => "127.0.0.1", hashIp: () => "test-hash" }));
vi.mock("@/lib/pubComparison.server", () => ({
  loadPubComparisonCatalogue: reads.catalogue,
  loadPubComparison: reads.compare,
  PubComparisonReadError: class extends Error {
    constructor(public readonly status: number, message: string) { super(message); }
  },
}));

import { PubComparisonReadError } from "@/lib/pubComparison.server";
import { GET, POST } from "@/app/api/pub-comparison/route";

const input = { venueIds: ["venue-a"], order: [{ category: "beer", drinkLabel: "Guinness", serving: "pint", quantity: 1 }] };
const request = (body: unknown = input) => new Request("https://pubmaxxing.com/api/pub-comparison", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  reads.limited.mockResolvedValue(false);
  reads.catalogue.mockResolvedValue({ status: "ready", venues: [], drinks: [], meetingPoints: [], coverage: "ready" });
  reads.compare.mockResolvedValue({ status: "ready", venues: [], completeVenueCount: 0, meetingPoint: null });
});

describe("pub comparison HTTP contract", () => {
  it("returns a private catalogue and permits an empty shortlist for meeting-point choices", async () => {
    const response = await GET(new Request("https://pubmaxxing.com/api/pub-comparison"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(reads.catalogue).toHaveBeenCalledWith([]);
  });

  it("returns a private result without putting the order into a URL", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(reads.compare).toHaveBeenCalledWith(input, expect.any(AbortSignal));
  });

  it.each(["venues=a,b,c,d", "venues=a,a", "venues=a&origin=home", "venues=a&venues=b", "venues=a%3Ftoken%3Dprivate"])('rejects invalid catalogue query %s', async (query) => {
    const response = await GET(new Request(`https://pubmaxxing.com/api/pub-comparison?${query}`));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(reads.catalogue).not.toHaveBeenCalled();
  });

  it("rejects an unknown origin field instead of silently dropping a constraint", async () => {
    const response = await POST(request({ ...input, origin: { latitude: 51.5, longitude: 0 } }));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(reads.compare).not.toHaveBeenCalled();
  });

  it("rejects a streamed oversized body before reading data", async () => {
    const response = await POST(new Request("https://pubmaxxing.com/api/pub-comparison", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ padding: "x".repeat(8193) }),
    }));
    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(reads.compare).not.toHaveBeenCalled();
  });

  it("answers malformed JSON with the common error envelope", async () => {
    const response = await POST(new Request("https://pubmaxxing.com/api/pub-comparison", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{",
    }));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ code: "INVALID_REQUEST", retryable: false });
  });

  it("rate limits before reading a body or querying prices", async () => {
    reads.limited.mockResolvedValue(true);
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(reads.compare).not.toHaveBeenCalled();
  });

  it("keeps failed data reads private and retryable", async () => {
    reads.compare.mockRejectedValue(new Error("internal filename or credential"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.text();
    expect(body).toContain('"retryable":true');
    expect(body).not.toContain("internal filename");
  });
});


describe("private error responses", () => {
  it.each([
    ["GET", 400], ["GET", 404], ["GET", 503],
    ["POST", 400], ["POST", 404], ["POST", 503],
  ] as const)("keeps %s data status %s private", async (method, status) => {
    reads.catalogue.mockRejectedValue(new PubComparisonReadError(status, "A selected pub cannot be read."));
    reads.compare.mockRejectedValue(new PubComparisonReadError(status, "A selected pub cannot be read."));
    const response = method === "GET"
      ? await GET(new Request("https://pubmaxxing.com/api/pub-comparison?venues=venue-a"))
      : await POST(request());
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ error: "A selected pub cannot be read.", retryable: status === 503 });
  });
  it.each(["GET", "POST"])("keeps %s rate limits private and stops the data read", async (method) => {
    reads.limited.mockResolvedValue(true);
    const response = method === "GET"
      ? await GET(new Request("https://pubmaxxing.com/api/pub-comparison"))
      : await POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(reads.catalogue).not.toHaveBeenCalled();
    expect(reads.compare).not.toHaveBeenCalled();
  });
  it("keeps an unexpected catalogue failure private", async () => {
    reads.catalogue.mockRejectedValue(new Error("internal path"));
    const response = await GET(new Request("https://pubmaxxing.com/api/pub-comparison"));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ code: "UNAVAILABLE", retryable: true });
  });
  it("rejects a non-JSON request without a shared cache", async () => {
    const response = await POST(new Request("https://pubmaxxing.com/api/pub-comparison", { method: "POST", body: "private order" }));
    expect(response.status).toBe(415);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(reads.compare).not.toHaveBeenCalled();
  });
});
