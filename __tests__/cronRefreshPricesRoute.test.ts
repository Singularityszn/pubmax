import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const collector = vi.hoisted(() => ({
  fetchPriceUpdates: vi.fn(),
}));

vi.mock("@/lib/priceRefresh.server", () => collector);

import { GET } from "@/app/api/cron/refresh-prices/route";
import {
  __resetFeedFreshnessStore,
  memoryFeedFreshnessStore,
} from "@/lib/feedFreshnessStore";

const FEED = "price_update_retrieval";
const PUBLISHED_FEED = "price_updates";
const OLD_STAMP = "2026-07-06T00:00:00.000Z";

function req(auth?: string): Request {
  return new Request("https://pubmaxxing.com/api/cron/refresh-prices", {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  __resetFeedFreshnessStore();
  collector.fetchPriceUpdates.mockReset();
  vi.stubEnv("CRON_SECRET", "test-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("GET /api/cron/refresh-prices", () => {
  it("401s without shared cron auth", async () => {
    const res = await GET(req("Bearer wrong"));

    expect(res.status).toBe(401);
    expect(collector.fetchPriceUpdates).not.toHaveBeenCalled();
  });

  it("leaves freshness unchanged and logs plainly when no rows were fetched", async () => {
    await memoryFeedFreshnessStore.stamp({
      feed: FEED,
      observedAt: OLD_STAMP,
      rowsServed: 4,
      note: "previous successful retrieval",
    });
    collector.fetchPriceUpdates.mockResolvedValue({
      updates: [],
      fetchedRows: 0,
      droppedRows: 0,
      sourcesChecked: 2,
      failedSources: [],
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await GET(req("Bearer test-secret"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      feed: FEED,
      fetchedRows: 0,
      retrievedRows: 0,
      freshnessAdvanced: false,
    });
    expect(await memoryFeedFreshnessStore.read(FEED)).toMatchObject({
      observedAt: OLD_STAMP,
      rowsServed: 4,
    });
    expect(
      warn.mock.calls.some(
        ([message]) =>
          typeof message === "string" &&
          message.includes("fetched no rows") &&
          message.includes("freshness unchanged"),
      ),
    ).toBe(true);
  });

  it("stamps freshness after valid rows are retrieved", async () => {
    collector.fetchPriceUpdates.mockResolvedValue({
      updates: [
        {
          venueKey: "the-crown|sw1a",
          price: 5.5,
          source: {
            label: "The Crown official menu",
            url: "https://example.com/the-crown/menu",
          },
          observedAt: "2026-07-27T06:30:00.000Z",
        },
      ],
      fetchedRows: 1,
      droppedRows: 0,
      sourcesChecked: 2,
      failedSources: [],
    });

    const res = await GET(req("Bearer test-secret"));
    const body = await res.json();
    const stamp = await memoryFeedFreshnessStore.read(FEED);

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      feed: FEED,
      fetchedRows: 1,
      retrievedRows: 1,
      freshnessAdvanced: true,
    });
    expect(stamp?.observedAt).toBe(body.observedAt);
    expect(stamp?.rowsServed).toBe(1);
    // Retrieval is not publication: the served snapshot's feed stays untouched.
    expect(await memoryFeedFreshnessStore.read(PUBLISHED_FEED)).toBeNull();
  });

  it("502s and leaves freshness untouched when collection fails", async () => {
    collector.fetchPriceUpdates.mockRejectedValue(new Error("provider down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(req("Bearer test-secret"));

    expect(res.status).toBe(502);
    expect(await memoryFeedFreshnessStore.read(FEED)).toBeNull();
    expect(error).toHaveBeenCalled();
  });

  it("502s and preserves freshness when every configured source fails", async () => {
    collector.fetchPriceUpdates.mockResolvedValue({
      updates: [],
      fetchedRows: 0,
      droppedRows: 0,
      sourcesChecked: 2,
      failedSources: [
        { id: "example-brewery-official", error: "provider down" },
        { id: "example-open-data", error: "provider down" },
      ],
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(req("Bearer test-secret"));

    expect(res.status).toBe(502);
    expect(await memoryFeedFreshnessStore.read(FEED)).toBeNull();
    expect(error).toHaveBeenCalled();
  });

  it("logs partial source failures while preserving no-op freshness", async () => {
    collector.fetchPriceUpdates.mockResolvedValue({
      updates: [],
      fetchedRows: 0,
      droppedRows: 0,
      sourcesChecked: 2,
      failedSources: [
        { id: "example-brewery-official", error: "provider down" },
      ],
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await GET(req("Bearer test-secret"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.freshnessAdvanced).toBe(false);
    expect(body.failedSources).toEqual(["example-brewery-official"]);
    expect(
      warn.mock.calls.some(
        ([message]) =>
          typeof message === "string" &&
          message.includes("partial source failure"),
      ),
    ).toBe(true);
  });
});
