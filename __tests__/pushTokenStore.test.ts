import { beforeEach, describe, expect, it } from "vitest";

// Exercise validation + the in-memory push-token store directly — no live
// Supabase, no env keys. This is the same backend the route uses when Supabase
// is unconfigured; the Supabase path shares validatePushToken and the DTO shape.
import {
  MAX_TOKEN_LENGTH,
  memoryPushTokenStore,
  validatePushToken,
  __listMemoryPushTokens,
  __resetMemoryPushTokens,
} from "@/lib/pushTokenStore";
import { MAX_PUSH_MUTATION_VERSION } from "@/lib/pushInstallation";
import { encodeWebPushSubscription } from "@/lib/webPushSubscription";

const WEB_TOKEN = encodeWebPushSubscription({
  endpoint: "https://updates.push.services.mozilla.com/wpush/v2/abc",
  expirationTime: null,
  keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
})!;
const INSTALLATION_ID = "00000000-0000-4000-8000-000000000047";

const linkAccount = (token: string, userId: string, sessionId: string, version = 1) =>
  memoryPushTokenStore.linkAccount(token, userId, sessionId, INSTALLATION_ID, version);
const unlinkAccount = (token: string, userId: string, sessionId: string, version = 2) =>
  memoryPushTokenStore.unlinkAccount(token, userId, sessionId, INSTALLATION_ID, version);
const linkPlan = (token: string, planId: string, memberId: string, version = 1) =>
  memoryPushTokenStore.linkPlan(token, planId, memberId, INSTALLATION_ID, version);
const unlinkPlan = (token: string, planId: string, memberId: string, version = 2) =>
  memoryPushTokenStore.unlinkPlan(token, planId, memberId, INSTALLATION_ID, version);

function uncheckedWebToken(endpoint: string): string {
  return `webpush:${Buffer.from(JSON.stringify({
    endpoint,
    expirationTime: null,
    keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
  })).toString("base64url")}`;
}

beforeEach(() => {
  __resetMemoryPushTokens();
});

describe("validatePushToken", () => {
  it("accepts a trimmed token with a known platform", () => {
    const result = validatePushToken({ token: "  apns-abc123  ", platform: "ios" });
    expect(result).toEqual({ ok: true, input: { token: "apns-abc123", platform: "ios" } });
  });

  it("rejects a missing / blank / non-string token", () => {
    for (const token of [undefined, "", "   ", 42, null]) {
      const result = validatePushToken({ token, platform: "ios" });
      expect(result.ok).toBe(false);
    }
  });

  it("rejects a token over the length cap", () => {
    const result = validatePushToken({
      token: "x".repeat(MAX_TOKEN_LENGTH + 1),
      platform: "ios",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects unknown platforms", () => {
    for (const platform of [undefined, "desktop", "IOS", 1]) {
      const result = validatePushToken({ token: "tok", platform });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/ios, android or web/);
    }
  });

  it("accepts a valid identity-free web subscription only on the web platform", () => {
    expect(validatePushToken({ token: WEB_TOKEN, platform: "web" })).toEqual({
      ok: true,
      input: { token: WEB_TOKEN, platform: "web" },
    });
    expect(validatePushToken({ token: WEB_TOKEN, platform: "ios" }).ok).toBe(false);
    expect(validatePushToken({ token: "not-a-subscription", platform: "web" }).ok).toBe(false);
  });

  it("rejects SSRF endpoints before persistence", () => {
    for (const endpoint of [
      "https://127.0.0.1/wpush/token",
      "https://10.0.0.8/wpush/token",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/wpush/token",
      "https://localhost/wpush/token",
      "https://push.example.test/wpush/token",
      "https://fcm.googleapis.com:444/fcm/send/token",
    ]) {
      expect(validatePushToken({ token: uncheckedWebToken(endpoint), platform: "web" }).ok, endpoint).toBe(false);
    }
  });
});

describe("memoryPushTokenStore", () => {
  it("saves a token and returns the public DTO shape", async () => {
    const dto = await memoryPushTokenStore.save({ token: "tok-1", platform: "ios" });
    expect(Object.keys(dto).sort()).toEqual(
      ["createdAt", "lastSeenAt", "platform", "token"].sort(),
    );
    expect(dto.token).toBe("tok-1");
    expect(dto.platform).toBe("ios");
    expect(typeof dto.createdAt).toBe("string");
  });

  it("re-registering the same token upserts (no duplicate rows)", async () => {
    const first = await memoryPushTokenStore.save({ token: "tok-1", platform: "ios" });
    const second = await memoryPushTokenStore.save({ token: "tok-1", platform: "ios" });
    expect(__listMemoryPushTokens()).toHaveLength(1);
    // Original registration time survives; last_seen refreshes.
    expect(second.createdAt).toBe(first.createdAt);
  });

  it("refuses anonymous rebinding of a token to another installation epoch", async () => {
    await memoryPushTokenStore.save({
      token: "tok-1",
      platform: "ios",
      installationId: INSTALLATION_ID,
    });
    await expect(memoryPushTokenStore.save({
      token: "tok-1",
      platform: "ios",
      installationId: "11111111-1111-4111-8111-111111111111",
    })).rejects.toThrow(/another installation/);
  });

  it("stores distinct tokens independently", async () => {
    await memoryPushTokenStore.save({ token: "tok-1", platform: "ios" });
    await memoryPushTokenStore.save({ token: "tok-2", platform: "android" });
    expect(__listMemoryPushTokens().map((t) => t.token)).toEqual(["tok-1", "tok-2"]);
  });

  it("stores a web subscription without attaching identity", async () => {
    const row = await memoryPushTokenStore.save({ token: WEB_TOKEN, platform: "web" });
    expect(row).toMatchObject({ token: WEB_TOKEN, platform: "web" });
    expect(row).not.toHaveProperty("userId");
    expect(row).not.toHaveProperty("planId");
  });

  it("links an account idempotently without exposing identity in public reads", async () => {
    await memoryPushTokenStore.save({ token: "tok-1", platform: "ios" });

    await expect(linkAccount("tok-1", "user-a", "session-a")).resolves.toBe("linked");
    await expect(linkAccount("tok-1", "user-a", "session-a")).resolves.toBe("replayed");
    expect(await memoryPushTokenStore.listForAccount("user-a")).toEqual([
      expect.objectContaining({ token: "tok-1" }),
    ]);
    expect(await memoryPushTokenStore.list()).toEqual([
      expect.not.objectContaining({ accountUserId: expect.anything() }),
    ]);
  });

  it("refuses cross-account reassignment until the verified owner unlinks", async () => {
    await memoryPushTokenStore.save({ token: "tok-1", platform: "ios" });
    await linkAccount("tok-1", "user-a", "session-a");

    await expect(linkAccount("tok-1", "user-b", "session-b", 2)).resolves.toBe("conflict");
    await unlinkAccount("tok-1", "user-b", "session-b", 2);
    expect(await memoryPushTokenStore.listForAccount("user-a")).toHaveLength(1);

    await unlinkAccount("tok-1", "user-a", "session-a", 3);
    await expect(linkAccount("tok-1", "user-b", "session-c", 4)).resolves.toBe("linked");
    expect(await memoryPushTokenStore.listForAccount("user-b")).toHaveLength(1);
  });

  it("supports privacy unlink-all without deleting identity-free registrations", async () => {
    for (const token of ["tok-1", "tok-2"]) {
      await memoryPushTokenStore.save({ token, platform: "ios" });
      await linkAccount(token, "user-a", "session-a");
    }
    await memoryPushTokenStore.unlinkAllForAccount("user-a");

    expect(await memoryPushTokenStore.listForAccount("user-a")).toEqual([]);
    expect(await memoryPushTokenStore.list()).toHaveLength(2);
  });

  it("links one verified member per token and Plan while allowing other Plans", async () => {
    await memoryPushTokenStore.save({ token: "tok-1", platform: "ios" });

    await expect(linkPlan("tok-1", "plan-a", "member-a")).resolves.toBe("linked");
    await expect(linkPlan("tok-1", "plan-a", "member-a")).resolves.toBe("replayed");
    await expect(linkPlan("tok-1", "plan-a", "member-b", 2)).resolves.toBe("conflict");
    await expect(linkPlan("tok-1", "plan-b", "member-b", 3)).resolves.toBe("linked");
    expect((await memoryPushTokenStore.listForPlan("plan-a")).map((row) => row.token)).toEqual(["tok-1"]);
    expect((await memoryPushTokenStore.listForPlan("plan-b")).map((row) => row.token)).toEqual(["tok-1"]);
  });

  it("makes wrong-member Plan unlink a no-op and cascades identity on token delete", async () => {
    await memoryPushTokenStore.save({ token: "tok-1", platform: "ios" });
    await linkAccount("tok-1", "user-a", "session-a");
    await linkPlan("tok-1", "plan-a", "member-a");

    await unlinkPlan("tok-1", "plan-a", "member-b");
    expect(await memoryPushTokenStore.listForPlan("plan-a")).toHaveLength(1);
    await memoryPushTokenStore.delete("tok-1");
    expect(await memoryPushTokenStore.listForPlan("plan-a")).toEqual([]);
    expect(await memoryPushTokenStore.listForAccount("user-a")).toEqual([]);
  });

  it("does not invent identity joins for missing registrations", async () => {
    await expect(linkAccount("missing", "user-a", "session-a")).resolves.toBe("missing");
    await expect(linkPlan("missing", "plan-a", "member-a")).resolves.toBe("missing");
  });

  it("tombstones a logged-out auth session against delayed relink", async () => {
    await memoryPushTokenStore.save({ token: "tok-1", platform: "ios" });
    await linkAccount("tok-1", "user-a", "session-old", 1);
    await unlinkAccount("tok-1", "user-a", "session-old", 2);

    await expect(linkAccount("tok-1", "user-a", "session-old", 1))
      .resolves.toBe("conflict");
    await expect(linkAccount("tok-1", "user-a", "session-new", 3))
      .resolves.toBe("linked");

    // Server arrival is authoritative even if this browser counter reset.
    await expect(unlinkAccount("tok-1", "user-a", "session-old", 2)).resolves.toBe(4);
    expect(await memoryPushTokenStore.listForAccount("user-a")).toEqual([]);
    await expect(linkAccount("tok-1", "user-a", "session-new", 3)).resolves.toBe("stale");
  });

  it("orders concurrent in-memory Plan link then unlink to an unlinked final state", async () => {
    await memoryPushTokenStore.save({ token: "tok-1", platform: "ios" });
    const linked = linkPlan("tok-1", "plan-a", "member-a", 1);
    const unlinked = unlinkPlan("tok-1", "plan-a", "member-a", 2);
    await Promise.all([linked, unlinked]);
    expect(await memoryPushTokenStore.listForPlan("plan-a")).toEqual([]);
  });

  it("records account revocation before any link and rejects the delayed older POST", async () => {
    await memoryPushTokenStore.save({ token: "tok-1", platform: "ios" });
    await unlinkAccount("tok-1", "user-a", "session-a", 2);
    await expect(linkAccount("tok-1", "user-a", "session-a", 1)).resolves.toBe("conflict");
    expect(await memoryPushTokenStore.listForAccount("user-a")).toEqual([]);
  });

  it("retains installation/session revocation across provider-token deletion", async () => {
    await memoryPushTokenStore.save({ token: "tok-1", platform: "ios" });
    await linkAccount("tok-1", "user-a", "session-a", 1);
    await unlinkAccount("tok-1", "user-a", "session-a", 2);
    await memoryPushTokenStore.delete("tok-1");
    await memoryPushTokenStore.save({ token: "tok-1", platform: "ios" });
    await expect(linkAccount("tok-1", "user-a", "session-a", 1)).resolves.toBe("conflict");
  });

  it("retains A and B session revocations so a very late A link stays blocked", async () => {
    await memoryPushTokenStore.save({ token: "tok-1", platform: "ios" });
    await linkAccount("tok-1", "user-a", "session-a", 1);
    await unlinkAccount("tok-1", "user-a", "session-a", 2);
    await linkAccount("tok-1", "user-a", "session-b", 3);
    await unlinkAccount("tok-1", "user-a", "session-b", 4);
    await expect(linkAccount("tok-1", "user-a", "session-a", 1)).resolves.toBe("conflict");
    await expect(linkAccount("tok-1", "user-a", "session-b", 3)).resolves.toBe("conflict");
  });

  it("keeps Plan unlink authoritative when DELETE reaches the server before delayed POST", async () => {
    await memoryPushTokenStore.save({ token: "tok-1", platform: "ios" });
    await unlinkPlan("tok-1", "plan-a", "member-a", 2);
    await expect(linkPlan("tok-1", "plan-a", "member-a", 1)).resolves.toBe("stale");
    expect(await memoryPushTokenStore.listForPlan("plan-a")).toEqual([]);
    await expect(linkPlan("tok-1", "plan-a", "member-a", 3)).resolves.toBe("linked");
  });

  it("revokes an installation without a provider token and blocks its old session", async () => {
    await memoryPushTokenStore.save({ token: "tok-1", platform: "ios" });
    await linkAccount("tok-1", "user-a", "session-a", 1);
    await memoryPushTokenStore.unlinkInstallationForAccount(
      INSTALLATION_ID,
      "user-a",
      "session-a",
      2,
    );
    expect(await memoryPushTokenStore.listForAccount("user-a")).toEqual([]);
    await expect(linkAccount("tok-1", "user-a", "session-a", 1)).resolves.toBe("conflict");
  });

  it("advances account and Plan watermarks above a reset local counter", async () => {
    await memoryPushTokenStore.save({ token: "tok-1", platform: "ios" });
    await linkAccount("tok-1", "user-a", "session-a", 10);
    await linkPlan("tok-1", "plan-a", "member-a", 10);

    await expect(memoryPushTokenStore.unlinkInstallationForAccount(
      INSTALLATION_ID,
      "user-a",
      "session-a",
      1,
    )).resolves.toBe(11);
    await expect(unlinkPlan("tok-1", "plan-a", "member-a", 1)).resolves.toBe(11);
    await expect(linkAccount("tok-1", "user-a", "session-a", 10)).resolves.toBe("conflict");
    await expect(linkPlan("tok-1", "plan-a", "member-a", 10)).resolves.toBe("stale");
  });

  it("rejects watermark overflow without claiming or applying revocation", async () => {
    await memoryPushTokenStore.save({ token: "tok-1", platform: "ios" });
    await linkAccount("tok-1", "user-a", "session-a", MAX_PUSH_MUTATION_VERSION);
    await linkPlan("tok-1", "plan-a", "member-a", MAX_PUSH_MUTATION_VERSION);

    await expect(memoryPushTokenStore.unlinkInstallationForAccount(
      INSTALLATION_ID,
      "user-a",
      "session-a",
      1,
    )).rejects.toThrow(/exhausted/);
    await expect(unlinkPlan("tok-1", "plan-a", "member-a", 1)).rejects.toThrow(/exhausted/);
    expect(await memoryPushTokenStore.listForAccount("user-a")).toHaveLength(1);
    expect(await memoryPushTokenStore.listForPlan("plan-a")).toHaveLength(1);
  });
});
