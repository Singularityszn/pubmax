import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/authServer", () => ({
  callerUserId: vi.fn(),
}));

import { callerUserId } from "@/lib/authServer";
import {
  __resetMemoryIdentityHandles,
  memoryIdentityHandleStore,
} from "@/lib/identityHandleStore";
import { gateHandleAction } from "@/lib/profileOwnership";
import {
  __resetMemoryProfiles,
  __seedMemoryLegacyProfile,
  memoryProfileStore,
} from "@/lib/profileStore";

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  __resetMemoryProfiles();
  __resetMemoryIdentityHandles();
  vi.mocked(callerUserId).mockReset();
  vi.mocked(callerUserId).mockResolvedValue("user-1");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("legacy handle freeze", () => {
  it("moves the owned profile and refuses its retired handle to every caller", async () => {
    const claimed = await memoryIdentityHandleStore.claim("user-1", "before_rename");
    expect(claimed).toMatchObject({ ok: true });
    const original = await memoryProfileStore.update("before_rename", {
      displayName: "Night Owl",
      bio: "London pub walks",
    });
    expect(original).not.toBeNull();
    expect(await memoryIdentityHandleStore.rename("user-1", "after_rename")).toMatchObject({ ok: true });
    expect(await memoryProfileStore.getByHandle("before_rename")).toBeNull();
    expect(await memoryProfileStore.getByUserId("user-1")).toMatchObject({
      ...original,
      handle: "after_rename",
      updatedAt: expect.any(String),
    });

    for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
      const request = new Request("http://localhost/api/profiles/before_rename", { method });
      for (const caller of [null, "user-1", "user-other"]) {
        expect(await gateHandleAction(request, "before_rename", caller)).toEqual({
          allowed: false,
          status: 409,
          error: "That handle is not available.",
        });
      }
      expect(await gateHandleAction(request, "after_rename", "user-1", {
        requireAccountOwner: true,
      })).toMatchObject({ allowed: true, callerUserId: "user-1", handle: "after_rename" });
      for (const caller of [null, "user-other"]) {
        expect(await gateHandleAction(request, "after_rename", caller)).toMatchObject({
          allowed: false,
          status: 403,
        });
      }
    }
    expect(await gateHandleAction(
      new Request("http://localhost/api/messages"),
      "before_rename",
      "user-1",
      { requireAccountOwner: true },
    )).toMatchObject({ allowed: false, status: 403 });
  });

  it("reserves retired aliases through both profile creation paths", async () => {
    await memoryIdentityHandleStore.claim("user-1", "before_rename");
    await memoryIdentityHandleStore.rename("user-1", "after_rename");
    await expect(memoryProfileStore.ensure("before_rename")).rejects.toThrow(/not available/);
    await expect(memoryProfileStore.createOwned("before_rename", "user-other")).rejects.toThrow(/not available/);

    expect(await memoryIdentityHandleStore.availability("before_rename")).toMatchObject({ available: false });
    expect(await memoryIdentityHandleStore.claim("user-other", "before_rename")).toMatchObject({ ok: false, code: "taken" });
    const current = await memoryProfileStore.getByUserId("user-1");
    expect(await memoryProfileStore.ensure("after_rename")).toEqual(current);
    expect(await memoryProfileStore.createOwned("after_rename", "user-1")).toEqual(current);
    expect(await memoryIdentityHandleStore.claim("user-1", "after_rename")).toMatchObject({
      ok: true,
      profileId: current?.id,
      foundingMemberNumber: current?.foundingMemberNumber,
    });
    expect(await memoryIdentityHandleStore.rename("user-1", "after_rename")).toMatchObject({
      ok: true,
      profileId: current?.id,
      previousHandle: "after_rename",
    });
    await memoryIdentityHandleStore.claim("user-other", "other_person");
    expect(await memoryIdentityHandleStore.rename("user-other", "before_rename")).toMatchObject({
      ok: false,
      code: "taken",
    });
  });

  it("refuses a legacy row that collides with another profile's alias", async () => {
    await memoryIdentityHandleStore.claim("user-1", "before_rename");
    await memoryIdentityHandleStore.rename("user-1", "after_rename");
    __seedMemoryLegacyProfile("after_rename");

    await expect(memoryProfileStore.ensure("after_rename")).rejects.toThrow(/not available/);
    await expect(memoryProfileStore.createOwned("after_rename", "user-other")).rejects.toThrow(/not available/);
    expect(await gateHandleAction(
      new Request("http://localhost/api/profiles/after_rename", { method: "PATCH" }),
      "after_rename",
      null,
    )).toMatchObject({ allowed: false, status: 409 });
  });

  it("preserves every historical alias after successive renames", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
    const claimed = await memoryIdentityHandleStore.claim("user-1", "first_name");
    expect(claimed.ok).toBe(true);
    await memoryIdentityHandleStore.rename("user-1", "second_name");
    expect(await memoryIdentityHandleStore.rename("user-1", "third_name")).toMatchObject({ ok: false, code: "cooldown" });
    vi.setSystemTime(new Date("2026-02-01T12:00:00Z"));
    expect(await memoryIdentityHandleStore.rename("user-1", "third_name")).toMatchObject({ ok: true });
    const current = await memoryProfileStore.getByUserId("user-1");
    for (const handle of ["first_name", "second_name", "third_name"]) {
      expect(await memoryIdentityHandleStore.resolve(handle)).toMatchObject({
        profileId: current?.id,
        currentHandle: "third_name",
        redirect: handle !== "third_name",
        status: "live",
      });
      expect(await memoryIdentityHandleStore.wornHandles(handle)).toEqual({
        currentHandle: "third_name",
        handles: ["first_name", "second_name", "third_name"],
      });
      expect(await memoryIdentityHandleStore.ownedHandle("user-1", [handle])).toBe(handle);
      expect(await memoryIdentityHandleStore.ownedHandle("user-other", [handle])).toBeNull();
    }
  });
  it("keeps an existing unlinked handle unavailable and unowned", async () => {
    const legacy = __seedMemoryLegacyProfile("old_timer");

    await expect(
      memoryIdentityHandleStore.availability("old_timer"),
    ).resolves.toEqual({
      handle: "old_timer",
      available: false,
      reason: "taken",
    });
    await expect(
      memoryIdentityHandleStore.claim("user-1", "old_timer"),
    ).resolves.toMatchObject({ ok: false, code: "taken" });
    const unchanged = await memoryProfileStore.getByHandle("old_timer");
    expect(unchanged?.id).toBe(legacy.id);
    expect(unchanged?.userId).toBeUndefined();
  });

  it("refuses first-touch linking of an existing unlinked handle", async () => {
    __seedMemoryLegacyProfile("old_timer");

    const gate = await gateHandleAction(
      new Request("http://localhost/api/messages", { method: "POST" }),
      "old_timer",
    );

    expect(gate).toEqual({
      allowed: false,
      status: 409,
      error: "That legacy handle is frozen. Choose a new handle for this account.",
    });
    expect((await memoryProfileStore.getByHandle("old_timer"))?.userId).toBeUndefined();
  });

  it("still creates a genuinely new handle and preserves linked owners", async () => {
    await expect(
      memoryIdentityHandleStore.claim("user-1", "fresh_person"),
    ).resolves.toMatchObject({
      ok: true,
      handle: "fresh_person",
    });
    await expect(
      memoryIdentityHandleStore.claim("user-1", "fresh_person"),
    ).resolves.toMatchObject({
      ok: true,
      handle: "fresh_person",
    });
    expect(await memoryProfileStore.getByHandle("fresh_person")).toMatchObject({
      userId: "user-1",
    });
  });

  it("keeps a post-migration generic ensure unavailable to canonical onboarding", async () => {
    const unowned = await memoryProfileStore.ensure("fresh_person");

    await expect(
      memoryIdentityHandleStore.availability("fresh_person"),
    ).resolves.toEqual({
      handle: "fresh_person",
      available: false,
      reason: "taken",
    });
    await expect(
      memoryIdentityHandleStore.claim("user-1", "fresh_person"),
    ).resolves.toMatchObject({
      ok: false,
      code: "taken",
    });
    const unchanged = await memoryProfileStore.getByHandle("fresh_person");
    expect(unchanged?.id).toBe(unowned.id);
    expect(unchanged?.userId).toBeUndefined();
  });

  it("keeps a current owner idempotent after the alias cache is lost", async () => {
    const first = await memoryIdentityHandleStore.claim("user-1", "fresh_person");
    expect(first).toMatchObject({ ok: true, handle: "fresh_person" });

    __resetMemoryIdentityHandles();

    await expect(
      memoryIdentityHandleStore.claim("user-1", "fresh_person"),
    ).resolves.toEqual(first);
  });

  it("reports the owned handle when two names race for one account", async () => {
    const results = await Promise.all([
      memoryIdentityHandleStore.claim("user-1", "racing_one"),
      memoryIdentityHandleStore.claim("user-1", "racing_two"),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      expect.objectContaining({ ok: false, code: "already_has_handle" }),
    ]);
  });
});
