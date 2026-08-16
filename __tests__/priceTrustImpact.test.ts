import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => false,
  requireSupabaseAdmin: () => {
    throw new Error(
      "Could not find the table 'public.price_trust_events' in the schema cache",
    );
  },
}));

import {
  __resetCommunityPrices,
  findCommunityPriceObservation,
  submitCommunityPrice,
} from "@/lib/communityPriceStore";
import {
  __resetMemoryIdentityHandles,
} from "@/lib/identityHandleStore";
import {
  __resetMemoryPrivateIdentities,
  memoryPrivateIdentityStore,
} from "@/lib/privateIdentityStore";
import {
  __resetMemoryProfiles,
} from "@/lib/profileStore";
import { __resetMemoryPriceTrustEvents, priceTrustEventStore } from "@/lib/priceTrustEventStore";
import {
  readPriceTrustImpact,
  syncTrustAfterPriceHidden,
  syncTrustAfterPriceWrite,
} from "@/lib/priceTrustImpact.server";

const NOW = Date.parse("2026-08-16T18:00:00.000Z");
const VENUE = "venue-one";
const USER_A = "00000000-0000-4000-8000-0000000000aa";
const USER_B = "00000000-0000-4000-8000-0000000000bb";
const USER_C = "00000000-0000-4000-8000-0000000000cc";

async function onboard(userId: string, handle: string): Promise<string> {
  const result = await memoryPrivateIdentityStore.completeOnboarding({
    userId,
    handle,
    dateOfBirth: "1990-01-01",
  });
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error("onboarding failed");
  return result.profileId;
}

async function logPrice(
  handle: string,
  profileId: string,
  priceGbp: number,
  at: number,
): Promise<string> {
  const { price } = await submitCommunityPrice(
    {
      venueId: VENUE,
      drinkCategory: "beer",
      priceGbp,
      actor: `profile:${profileId}`,
      contributorHandle: handle,
    },
    at,
  );
  expect(price?.id).toBeTruthy();
  return price!.id!;
}

beforeEach(() => {
  __resetCommunityPrices();
  __resetMemoryPriceTrustEvents();
  __resetMemoryProfiles();
  __resetMemoryPrivateIdentities();
  __resetMemoryIdentityHandles();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("syncTrustAfterPriceWrite", () => {
  it("credits every independent contributor in the first cluster once", async () => {
    const profileA = await onboard(USER_A, "alice_pint");
    const profileB = await onboard(USER_B, "bob_pint");
    const profileC = await onboard(USER_C, "cara_pint");

    await logPrice("alice_pint", profileA, 4.2, NOW - 3_000);
    await syncTrustAfterPriceWrite(VENUE, "beer", NOW - 3_000);
    expect(await readPriceTrustImpact(USER_A)).toEqual({
      status: "ready",
      observationsLogged: 1,
      pricesTrustedNow: 0,
      lifetimeTrustUnlocks: 0,
    });

    await logPrice("bob_pint", profileB, 4.2, NOW - 2_000);
    await syncTrustAfterPriceWrite(VENUE, "beer", NOW - 2_000);

    const a = await readPriceTrustImpact(USER_A);
    const b = await readPriceTrustImpact(USER_B);
    expect(a).toEqual({
      status: "ready",
      observationsLogged: 1,
      pricesTrustedNow: 1,
      lifetimeTrustUnlocks: 1,
    });
    expect(b).toEqual({
      status: "ready",
      observationsLogged: 1,
      pricesTrustedNow: 1,
      lifetimeTrustUnlocks: 1,
    });

    await logPrice("cara_pint", profileC, 4.3, NOW - 100);
    await syncTrustAfterPriceWrite(VENUE, "beer", NOW - 100);
    expect(await readPriceTrustImpact(USER_C)).toEqual({
      status: "ready",
      observationsLogged: 1,
      pricesTrustedNow: 0,
      lifetimeTrustUnlocks: 0,
    });
    expect(await readPriceTrustImpact(USER_A)).toMatchObject({
      lifetimeTrustUnlocks: 1,
    });
    expect((await priceTrustEventStore().liveEventsFor(VENUE, "beer")).events).toHaveLength(1);
  });

  it("does not treat a later agreeing report as a second unlock", async () => {
    const profileA = await onboard(USER_A, "alice_pint");
    const profileB = await onboard(USER_B, "bob_pint");
    await logPrice("alice_pint", profileA, 4.2, NOW - 3_000);
    await logPrice("bob_pint", profileB, 4.2, NOW - 2_000);
    await syncTrustAfterPriceWrite(VENUE, "beer", NOW - 2_000);
    await syncTrustAfterPriceWrite(VENUE, "beer", NOW - 1_000);
    expect(await readPriceTrustImpact(USER_A)).toMatchObject({
      lifetimeTrustUnlocks: 1,
    });
    expect((await priceTrustEventStore().liveEventsFor(VENUE, "beer")).events).toHaveLength(1);
  });
});

describe("syncTrustAfterPriceHidden", () => {
  it("writes a reversal, revokes visible credit, and replaces when remaining evidence still qualifies", async () => {
    const profileA = await onboard(USER_A, "alice_pint");
    const profileB = await onboard(USER_B, "bob_pint");
    const profileC = await onboard(USER_C, "cara_pint");
    const hiddenId = await logPrice("alice_pint", profileA, 4.2, NOW - 4_000);
    await logPrice("bob_pint", profileB, 4.2, NOW - 3_000);
    await syncTrustAfterPriceWrite(VENUE, "beer", NOW - 3_000);
    await logPrice("cara_pint", profileC, 4.2, NOW - 500);
    await syncTrustAfterPriceWrite(VENUE, "beer", NOW - 500);

    const { observation } = await findCommunityPriceObservation(hiddenId);
    expect(observation?.id).toBe(hiddenId);

    const { moderateCommunityPrice } = await import("@/lib/communityPriceStore");
    expect(await moderateCommunityPrice(hiddenId, true, "menu mismatch")).toBe(true);
    await syncTrustAfterPriceHidden(hiddenId, NOW);

    expect(await readPriceTrustImpact(USER_A)).toEqual({
      status: "ready",
      observationsLogged: 1,
      pricesTrustedNow: 0,
      lifetimeTrustUnlocks: 0,
    });
    expect(await readPriceTrustImpact(USER_B)).toEqual({
      status: "ready",
      observationsLogged: 1,
      pricesTrustedNow: 1,
      lifetimeTrustUnlocks: 1,
    });
    expect(await readPriceTrustImpact(USER_C)).toEqual({
      status: "ready",
      observationsLogged: 1,
      pricesTrustedNow: 1,
      lifetimeTrustUnlocks: 1,
    });
    expect((await priceTrustEventStore().liveEventsFor(VENUE, "beer")).events).toHaveLength(1);
  });
});

describe("readPriceTrustImpact", () => {
  it("does not answer zeros when a store read is degraded", async () => {
    await onboard(USER_A, "alice_pint");
    vi.spyOn(priceTrustEventStore(), "readVisibleImpact").mockResolvedValue({
      lifetimeTrustUnlocks: 0,
      eventIds: [],
      events: [],
      degraded: true,
    });
    expect(await readPriceTrustImpact(USER_A)).toEqual({ status: "degraded" });
  });
});
