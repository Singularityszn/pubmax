// The reviewed feed reads APPROVED rows and nothing else.
//
// A pending candidate is a third-party claim nobody has checked, and a rejected
// one is a claim somebody refused, so neither may reach a reader. The other
// half is honesty about the read itself: a durable store we could not reach is
// reported, and the bundled snapshot still answers, because a feed that goes
// quiet on a store error tells a reader the city has nothing on.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { storeOverride } = vi.hoisted(() => ({
  storeOverride: { candidates: null as unknown, durable: null as boolean | null },
}));
vi.mock("@/lib/pushSender", () => ({
  fireAndForgetPush: vi.fn(),
  maybeBroadcastNightSignalLive: vi.fn(),
}));
vi.mock("@/lib/nightSignalStore.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/nightSignalStore.server")>();
  return {
    ...actual,
    nightSignalCandidateStore: () => storeOverride.candidates ?? actual.nightSignalCandidateStore(),
    nightSignalStoreIsDurable: () => storeOverride.durable ?? actual.nightSignalStoreIsDurable(),
  };
});

import { GET } from "@/app/api/night-signals/route";
import type { NightSignalClaim } from "@/lib/nightSignalClaims";
import {
  nightSignalCandidateStore,
  resetNightSignalStoreMemory,
} from "@/lib/nightSignalStore.server";

const NOW = Date.parse("2026-09-05T20:00:00.000Z");
const DAY = 24 * 60 * 60_000;

function claim(id: string, overrides: Partial<NightSignalClaim> = {}): NightSignalClaim {
  return {
    id,
    kind: "opening",
    entity: { type: "night_area", id: "camden" },
    claim: "The Camden Arms reopens as a late-night taproom on Chalk Farm Road",
    sourceUrl: `https://example.com/london/${id}`,
    publisher: "example.com",
    publishedAt: new Date(NOW - 3 * DAY).toISOString(),
    observedAt: new Date(NOW - DAY).toISOString(),
    expiresAt: new Date(NOW + 20 * DAY).toISOString(),
    confidence: 0.5,
    reviewState: "pending",
    verification: "single_source",
    routeEffect: "none",
    corroboratingSources: [],
    reviewedAt: null,
    reviewAuthority: null,
    ...overrides,
  };
}

function approved(id: string, overrides: Partial<NightSignalClaim> = {}): NightSignalClaim {
  return claim(id, {
    reviewState: "approved",
    reviewedAt: new Date(NOW - 60_000).toISOString(),
    reviewAuthority: "operations",
    ...overrides,
  });
}

function req(query = ""): Request {
  return new Request(`https://pubmaxxing.com/api/night-signals${query}`);
}

beforeEach(() => {
  resetNightSignalStoreMemory();
  storeOverride.candidates = null;
  storeOverride.durable = null;
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/night-signals", () => {
  it("serves an approved claim and never a pending or rejected one", async () => {
    await nightSignalCandidateStore().save([
      approved("opening:camden:20260901:aaaa1111"),
      claim("opening:camden:20260901:bbbb2222"),
      claim("opening:camden:20260901:cccc3333", {
        reviewState: "rejected",
        reviewedAt: new Date(NOW - 60_000).toISOString(),
        reviewAuthority: "operations",
      }),
    ]);

    const body = await (await GET(req())).json();
    expect(body.durable).toBe("ready");
    const ids = (body.claims as NightSignalClaim[]).map((row) => row.id);
    expect(ids).toContain("opening:camden:20260901:aaaa1111");
    expect(ids).not.toContain("opening:camden:20260901:bbbb2222");
    expect(ids).not.toContain("opening:camden:20260901:cccc3333");
    for (const row of body.claims as NightSignalClaim[]) {
      expect(row.reviewState).toBe("approved");
      expect(row.reviewedAt).toBeTruthy();
    }
  });

  it("drops an approved claim that has run out of window", async () => {
    await nightSignalCandidateStore().save([
      approved("opening:camden:20260801:dddd4444", {
        observedAt: new Date(NOW - 40 * DAY).toISOString(),
        publishedAt: new Date(NOW - 41 * DAY).toISOString(),
        reviewedAt: new Date(NOW - 39 * DAY).toISOString(),
        expiresAt: new Date(NOW - DAY).toISOString(),
      }),
    ]);
    const body = await (await GET(req())).json();
    expect((body.claims as NightSignalClaim[]).map((row) => row.id)).not.toContain(
      "opening:camden:20260801:dddd4444",
    );
  });

  it("narrows to one entity when asked", async () => {
    await nightSignalCandidateStore().save([
      approved("opening:camden:20260901:aaaa1111"),
      approved("opening:brixton:20260901:eeee5555", {
        entity: { type: "night_area", id: "brixton" },
      }),
    ]);
    const body = await (await GET(req("?entityId=brixton"))).json();
    expect((body.claims as NightSignalClaim[]).map((row) => row.entity.id)).toEqual(["brixton"]);
  });

  it("says a durable read failed rather than serving an empty city", async () => {
    storeOverride.candidates = {
      save: async () => ({ status: "unavailable", reason: "connection refused" }),
      list: async () => ({ status: "unavailable", reason: "connection refused" }),
      approved: async () => ({ status: "unavailable", reason: "connection refused" }),
      review: async () => ({ status: "unavailable", reason: "connection refused" }),
    };
    const response = await GET(req());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.durable).toBe("unavailable");
    // The committed snapshot is still the answer, whatever it holds today.
    expect(Array.isArray(body.claims)).toBe(true);
    expect(body.asOf).toBeTruthy();
  });

  it("holds a body that read mutable rows out of the edge cache", async () => {
    // Keyless: the answer is a pure function of the deployment, so it keeps the
    // short cache window it always had.
    expect((await GET(req())).headers.get("cache-control")).toContain("s-maxage=300");

    // With a durable store the body carries rows a moderator can change at any
    // moment, so it may not be held at the edge.
    storeOverride.durable = true;
    expect((await GET(req())).headers.get("cache-control")).toBe("no-store");
  });
});
