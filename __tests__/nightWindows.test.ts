import { beforeEach, describe, expect, it } from "vitest";

import { isPlanActiveNow } from "@/lib/activePlan";
import { planScheduledEndMs } from "@/lib/inviteExpiry";
import { planBeaconExpiry } from "@/lib/planBeacon";
import { isPlanLiveLocationOpen } from "@/lib/planLiveLocation";
import { __resetPresence, markPresence, recentPresence } from "@/lib/presenceStore";

const HOUR = 60 * 60 * 1000;
const startTime = "2026-11-13T19:00:00.000Z";
const start = Date.parse(startTime);

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetPresence();
});

describe("the night windows keep their lengths", () => {
  it("a Plan is on tonight from 3 hours before its start to 8 hours after", () => {
    const ref = { id: "11111111-1111-4111-8111-111111111111", startTime, stopIndex: 0 };
    expect([start - 3 * HOUR - 1, start - 3 * HOUR, start + 8 * HOUR, start + 8 * HOUR + 1].map((now) => isPlanActiveNow(ref, now)))
      .toEqual([false, true, true, false]);
    expect(planScheduledEndMs(startTime)).toBe(start + 8 * HOUR);
  });

  it("live location opens 3 hours before the start", () => {
    expect([start - 3 * HOUR - 1, start - 3 * HOUR].map((now) => isPlanLiveLocationOpen(startTime, "ready", now))).toEqual([false, true]);
  });

  it("a beacon lasts 2 hours", () => {
    expect(planBeaconExpiry(startTime, new Date(start))).toBe(new Date(start + 2 * HOUR).toISOString());
  });

  it("presence lasts 2 hours", async () => {
    await markPresence({ handle: "old_ken", venueId: "venue-test-1", actorHash: "actor" }, start);
    expect((await recentPresence(undefined, start + 2 * HOUR - 1)).length).toBe(1);
    expect((await recentPresence(undefined, start + 2 * HOUR + 1)).length).toBe(0);
  });
});
