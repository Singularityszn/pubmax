import { beforeEach, describe, expect, it, vi } from "vitest";

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
  memoryProfileStore,
} from "@/lib/profileStore";

beforeEach(() => {
  __resetMemoryProfiles();
  __resetMemoryIdentityHandles();
  vi.mocked(callerUserId).mockReset();
  vi.mocked(callerUserId).mockResolvedValue("user-1");
});

describe("legacy handle freeze", () => {
  it("keeps an existing unlinked handle unavailable and unowned", async () => {
    const legacy = await memoryProfileStore.ensure("old_timer");

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
    await memoryProfileStore.ensure("old_timer");

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
});
