import { beforeEach, describe, expect, it, vi } from "vitest";

// Wave L3 identity claim helpers — memory stores only, no network.

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    requiresSupabaseStore: () => false,
  };
});

import {
  buildClaimPreview,
  decideClaimNeed,
  performClaim,
} from "@/lib/identityClaim";
import { followStore, __resetMemoryFollows } from "@/lib/followStore";
import { __resetPintDrops, addPintDrop, type PintDrop } from "@/lib/pintDrops";
import { memoryProfileStore, __resetMemoryProfiles } from "@/lib/profileStore";
import { savedPubsStore, __resetMemorySavedPubs } from "@/lib/savedPubsStore";

function makeDrop(overrides: Partial<PintDrop> = {}): PintDrop {
  return {
    id: "drop-1",
    venueId: "venue-1",
    handle: "@ken",
    drink: "Bitter",
    priceGbp: 5.2,
    passedDownNote: "A note",
    era: "",
    provenance: "contributor",
    status: "visible",
    visibility: "public",
    createdAt: "2026-07-07T12:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemoryProfiles();
  __resetMemoryFollows();
  __resetMemorySavedPubs();
  __resetPintDrops();
});

describe("decideClaimNeed", () => {
  it("is false for same handle with no activity and no conflicts", () => {
    expect(
      decideClaimNeed({
        deviceHandle: "ken",
        authHandle: "ken",
        sameHandle: true,
        deviceActivity: { drops: 0, saves: 0, follows: 0 },
        deviceAlreadyLinkedToOther: false,
        authHandleAlreadyLinkedToOther: false,
      }),
    ).toBe(false);
  });

  it("is true when handles differ", () => {
    expect(
      decideClaimNeed({
        deviceHandle: "ken",
        authHandle: "sam",
        sameHandle: false,
        deviceActivity: { drops: 0, saves: 0, follows: 0 },
        deviceAlreadyLinkedToOther: false,
        authHandleAlreadyLinkedToOther: false,
      }),
    ).toBe(true);
  });

  it("is true when device has activity even on the same handle", () => {
    expect(
      decideClaimNeed({
        deviceHandle: "ken",
        authHandle: "ken",
        sameHandle: true,
        deviceActivity: { drops: 2, saves: 0, follows: 0 },
        deviceAlreadyLinkedToOther: false,
        authHandleAlreadyLinkedToOther: false,
      }),
    ).toBe(true);
  });

  it("is true on ownership conflicts", () => {
    expect(
      decideClaimNeed({
        deviceHandle: "ken",
        authHandle: "ken",
        sameHandle: true,
        deviceActivity: { drops: 0, saves: 0, follows: 0 },
        deviceAlreadyLinkedToOther: true,
        authHandleAlreadyLinkedToOther: false,
      }),
    ).toBe(true);
  });
});

describe("buildClaimPreview", () => {
  it("marks sameHandle and empty activity for a fresh matching pair", async () => {
    const preview = await buildClaimPreview({
      deviceHandle: "Ken",
      authHandle: "@ken",
      callerUserId: "user-1",
    });
    expect(preview.sameHandle).toBe(true);
    expect(preview.deviceHandle).toBe("ken");
    expect(preview.authHandle).toBe("ken");
    expect(preview.deviceActivity).toEqual({ drops: 0, saves: 0, follows: 0 });
    expect(preview.deviceAlreadyLinkedToOther).toBe(false);
    expect(preview.authHandleAlreadyLinkedToOther).toBe(false);
    expect(decideClaimNeed(preview)).toBe(false);
  });

  it("counts drops, saves, and follows on the device handle", async () => {
    addPintDrop(makeDrop({ id: "d1", handle: "@device_ken" }));
    addPintDrop(makeDrop({ id: "d2", handle: "@device_ken" }));
    await savedPubsStore().toggleSaved({
      handle: "device_ken",
      venueId: "venue-1",
      listType: "Want to Visit",
    });
    await followStore().follow("device_ken", "sam");
    await followStore().follow("ale", "device_ken");

    const preview = await buildClaimPreview({
      deviceHandle: "device_ken",
      authHandle: "google_ken",
      callerUserId: "user-1",
    });
    expect(preview.sameHandle).toBe(false);
    expect(preview.deviceActivity.drops).toBe(2);
    expect(preview.deviceActivity.saves).toBe(1);
    expect(preview.deviceActivity.follows).toBe(2);
    expect(decideClaimNeed(preview)).toBe(true);
  });

  it("flags handles already linked to another user", async () => {
    await memoryProfileStore.linkUser("device_ken", "user-other");
    await memoryProfileStore.linkUser("google_ken", "user-other-2");

    const preview = await buildClaimPreview({
      deviceHandle: "device_ken",
      authHandle: "google_ken",
      callerUserId: "user-1",
    });
    expect(preview.deviceAlreadyLinkedToOther).toBe(true);
    expect(preview.authHandleAlreadyLinkedToOther).toBe(true);
  });

  it("does not flag handles already linked to THIS caller", async () => {
    await memoryProfileStore.linkUser("ken", "user-1");
    const preview = await buildClaimPreview({
      deviceHandle: "ken",
      authHandle: "ken",
      callerUserId: "user-1",
    });
    expect(preview.deviceAlreadyLinkedToOther).toBe(false);
    expect(preview.authHandleAlreadyLinkedToOther).toBe(false);
  });
});

describe("performClaim", () => {
  it("links the device handle when choice is device and it has activity", async () => {
    addPintDrop(makeDrop({ handle: "@device_ken", id: "drop-device" }));
    const result = await performClaim({
      choice: "device",
      deviceHandle: "device_ken",
      authHandle: "google_ken",
      callerUserId: "user-1",
    });
    expect(result).toEqual({ ok: true, handle: "device_ken", linked: true });
    const row = await memoryProfileStore.getByHandle("device_ken");
    expect(row?.userId).toBe("user-1");
  });

  it("rejects claiming an empty different device handle", async () => {
    const result = await performClaim({
      choice: "device",
      deviceHandle: "empty_fisher",
      authHandle: "google_ken",
      callerUserId: "user-1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/no pubs/i);
    }
  });

  it("links the auth handle when choice is auth", async () => {
    const result = await performClaim({
      choice: "auth",
      deviceHandle: "device_ken",
      authHandle: "google_ken",
      callerUserId: "user-1",
    });
    expect(result).toEqual({ ok: true, handle: "google_ken", linked: true });
    const row = await memoryProfileStore.getByHandle("google_ken");
    expect(row?.userId).toBe("user-1");
  });

  it("is idempotent when already linked to this user", async () => {
    addPintDrop(makeDrop({ handle: "@device_ken", id: "drop-device-2" }));
    await memoryProfileStore.linkUser("device_ken", "user-1");
    const result = await performClaim({
      choice: "device",
      deviceHandle: "device_ken",
      authHandle: "google_ken",
      callerUserId: "user-1",
    });
    expect(result.ok).toBe(true);
  });

  it("returns 409 when the chosen device handle belongs to someone else", async () => {
    addPintDrop(makeDrop({ handle: "@device_ken", id: "drop-device-3" }));
    await memoryProfileStore.linkUser("device_ken", "user-other");
    const result = await performClaim({
      choice: "device",
      deviceHandle: "device_ken",
      authHandle: "google_ken",
      callerUserId: "user-1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toMatch(/another account/i);
    }
  });

  it("returns 409 when the chosen auth handle belongs to someone else", async () => {
    await memoryProfileStore.linkUser("google_ken", "user-other");
    const result = await performClaim({
      choice: "auth",
      deviceHandle: "device_ken",
      authHandle: "google_ken",
      callerUserId: "user-1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });

  it("returns 401 without a caller", async () => {
    const result = await performClaim({
      choice: "device",
      deviceHandle: "ken",
      authHandle: "sam",
      callerUserId: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });
});
