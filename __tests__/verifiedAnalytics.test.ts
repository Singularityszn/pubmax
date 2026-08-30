import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { __resetMemoryAnalyticsReceipts, memoryAnalyticsReceiptStore } from "@/lib/analyticsReceiptStore";
import {
  analyticsDeliveryTokenDigest,
  crewCommittedEventToken,
  mintVerifiedAnalyticsToken,
  verifyAnalyticsDeliveryToken,
} from "@/lib/verifiedAnalytics.server";

describe("verified analytics delivery", () => {
  const occurredAt = "2026-07-20T12:00:00.000Z";
  const event = {
    name: "plan_accepted" as const,
    props: { stops: 3, grounded: true, anchored: true, routeReady: true, source: "near" },
  };

  beforeEach(() => __resetMemoryAnalyticsReceipts());

  it("mints a stable token bound to the exact sanitized event", () => {
    const first = mintVerifiedAnalyticsToken(event, "plan:one", occurredAt);
    const replay = mintVerifiedAnalyticsToken(event, "plan:one", occurredAt);

    expect(replay).toBe(first);
    expect(verifyAnalyticsDeliveryToken(first, event, Date.parse(occurredAt) + 1_000)).toMatchObject({
      name: "plan_accepted",
      props: { stops: 3, grounded: true, anchored: true, routeReady: true, source: "near" },
    });
    expect(verifyAnalyticsDeliveryToken(first, { ...event, props: { stops: 2, grounded: true } }, Date.parse(occurredAt) + 1_000)).toBeNull();
  });

  it("rejects expired tokens and occurrence times beyond the clock-skew bound", () => {
    const issuedAt = Date.parse(occurredAt);
    const token = mintVerifiedAnalyticsToken(event, "plan:bounded", occurredAt);
    const futureToken = mintVerifiedAnalyticsToken(event, "plan:future", new Date(issuedAt + 31_000).toISOString());

    expect(verifyAnalyticsDeliveryToken(token, event, issuedAt + 31 * 24 * 60 * 60 * 1_000)).toBeNull();
    expect(verifyAnalyticsDeliveryToken(futureToken, event, issuedAt)).toBeNull();
  });

  it("durably claims one event id and reports delivered on replay", async () => {
    const token = mintVerifiedAnalyticsToken(event, "plan:one", occurredAt);
    const claims = verifyAnalyticsDeliveryToken(token, event, Date.parse(occurredAt) + 1_000)!;
    const input = {
      eventId: claims.eventId,
      tokenDigest: analyticsDeliveryTokenDigest(token),
      eventName: event.name,
      now: new Date("2026-07-20T12:00:01.000Z"),
    };

    expect(await memoryAnalyticsReceiptStore.claim(input)).toBe("claimed");
    expect(await memoryAnalyticsReceiptStore.complete(claims.eventId)).toBe(true);
    expect(await memoryAnalyticsReceiptStore.claim(input)).toBe("delivered");
  });

  it("accepts a refreshed crew token once but rejects digest rotation for other events", async () => {
    const crewEvent = {
      name: "crew_committed" as const,
      props: { source: "shared-plan" as const, participants: 2 as const },
    };
    const eventId = "11111111-1111-4111-8111-111111111111";
    const first = crewCommittedEventToken({
      crewCommittedEventId: eventId,
      crewCommittedAt: occurredAt,
      issuedAt: Date.parse(occurredAt),
    });
    const refreshed = crewCommittedEventToken({
      crewCommittedEventId: eventId,
      crewCommittedAt: occurredAt,
      issuedAt: Date.parse(occurredAt) + 31 * 24 * 60 * 60 * 1_000,
    });
    const firstClaims = verifyAnalyticsDeliveryToken(first, crewEvent, Date.parse(occurredAt) + 1_000)!;
    const refreshedClaims = verifyAnalyticsDeliveryToken(
      refreshed,
      crewEvent,
      Date.parse(occurredAt) + 31 * 24 * 60 * 60 * 1_000 + 1_000,
    )!;

    expect(firstClaims.eventId).toBe(eventId);
    expect(refreshedClaims.eventId).toBe(eventId);
    expect(await memoryAnalyticsReceiptStore.claim({
      eventId,
      tokenDigest: analyticsDeliveryTokenDigest(first),
      eventName: crewEvent.name,
      now: new Date("2026-07-20T12:00:01.000Z"),
    })).toBe("claimed");
    expect(await memoryAnalyticsReceiptStore.complete(eventId)).toBe(true);
    expect(await memoryAnalyticsReceiptStore.claim({
      eventId,
      tokenDigest: analyticsDeliveryTokenDigest(refreshed),
      eventName: crewEvent.name,
      now: new Date("2026-08-20T12:00:01.000Z"),
    })).toBe("delivered");
    expect(await memoryAnalyticsReceiptStore.claim({
      eventId,
      tokenDigest: analyticsDeliveryTokenDigest(refreshed),
      eventName: event.name,
      now: new Date("2026-08-20T12:00:02.000Z"),
    })).toBe("conflict");
  });

  it("keeps durable claim and completion atomic and service-role only", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260723120000_0051_analytics_event_receipts.sql"), "utf8");

    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("status in ('pending', 'delivered')");
    expect(sql).toContain("revoke all on table public.analytics_event_receipts from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.claim_analytics_event_receipt");
    expect(sql).not.toContain("anonymous_id");
    expect(sql).not.toContain("delivery_token");
  });
});
