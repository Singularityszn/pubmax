import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ userId: "owner", member: true, limited: false, ipLimited: false, allowed: true, muted: false, latestUnavailable: false, activeSession: true, membershipUnavailable: false, prefs: { enabled: false, preview: false } }));
const savePreferences = vi.fn(async (_userId: string, prefs: typeof state.prefs) => { state.prefs = prefs; });
const setMuted = vi.fn();
const presence = vi.fn();
const release = vi.fn();
const saveToken = vi.fn();
vi.mock("@/lib/authServer", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/authServer")>(), callerUserId: async () => state.userId || null }));
vi.mock("@/lib/profileStore", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/profileStore")>(), profileStore: () => ({ getHandleByUserId: async () => "ken", getByUserId: async (userId: string) => ({ id: "ken", handle: "ken", userId }), getByHandle: async (handle: string) => ({ id: handle, handle, userId: handle === "ken" ? "owner" : "sender" }) }) }));
vi.mock("@/lib/messagesStore", () => ({ messagesStore: () => ({ membership: async () => { if (state.membershipUnavailable) throw new Error("membership unavailable"); return state.member ? { handles: ["ken", "sam"] } : null; }, listMessages: async () => { if (state.latestUnavailable) throw new Error("latest message unavailable"); return [{ senderHandle: "sam" }]; } }) }));
vi.mock("@/lib/messageNotifications.server", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/messageNotifications.server")>(), messageNotificationSenderAllowed: async () => state.allowed }));
vi.mock("@/lib/pintDrops", () => ({ isLimited: async (key: string) => key.startsWith("message-notification-preview-ip:") ? state.ipLimited : state.limited }));
vi.mock("@/lib/messageNotificationStore", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/messageNotificationStore")>();
  return { ...actual, messageNotificationStore: () => ({ preferences: async () => state.prefs, muted: async () => state.muted, savePreferences, setMuted, presence: async (...args: Parameters<typeof actual.memoryMessageNotificationStore.presence>) => {
    presence(...args);
    return actual.memoryMessageNotificationStore.presence(...args);
  }, startPresence: actual.memoryMessageNotificationStore.startPresence, release, saveToken, sessionActive: async () => state.activeSession }) };
});

import { DELETE, GET, POST, PUT } from "@/app/api/message-notifications/route";
import { memoryMessageNotificationStore as realStore } from "@/lib/messageNotificationStore";
import { encodeWebPushSubscription } from "@/lib/webPushSubscription";

const THREAD = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";
const jwt = `header.${Buffer.from(JSON.stringify({ sub: "owner", session_id: SESSION })).toString("base64url")}.signature`;
const request = (body: unknown, method = "POST") => new Request("https://pubmaxxing.com/api/message-notifications", { method, body: JSON.stringify(body), headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` } });
beforeEach(() => { Object.assign(state, { userId: "owner", member: true, limited: false, ipLimited: false, allowed: true, muted: false, latestUnavailable: false, activeSession: true, membershipUnavailable: false, prefs: { enabled: false, preview: false } }); vi.clearAllMocks(); });

describe("message notification ownership", () => {
  it("limits previews before reading their body", async () => {
    state.ipLimited = true;
    const body = new Request("https://pubmaxxing.com/api/message-notifications", { method: "PUT", body: "{" });
    expect((await PUT(body)).status).toBe(429);
    expect(body.bodyUsed).toBe(false);
  });
  it.each([["POST", POST], ["PUT", PUT], ["DELETE", DELETE]] as const)("rejects oversized %s bodies", async (method, handler) => {
    expect((await handler(request({ token: "x".repeat(65536) }, method))).status).toBe(413);
  });
  it("reserves a durable floor for the exact verified session and applies its presence", async () => {
    const token = encodeWebPushSubscription({ endpoint: "https://web.push.apple.com/route-floor", keys: { p256dh: "public_key_material", auth: "secret_auth_material" } })!;
    await realStore.saveToken("owner", token, SESSION, 1);
    const reserve = () => POST(request({ action: "presence-start", token, userId: "stranger", sessionId: "asserted" }));
    const first = await reserve();
    expect(first.status).toBe(200);
    const { activityId } = await first.json();
    expect(activityId).toBeGreaterThan(0);
    const applied = await POST(request({ action: "presence", presenceVersion: 2, token, conversationId: THREAD, activityId, revision: 1 }));
    expect(applied.status).toBe(200);
    expect(await applied.json()).toEqual({ ok: true, applied: true });
    const stale = await POST(request({ action: "presence", presenceVersion: 2, token, conversationId: null, activityId, revision: 1 }));
    expect(await stale.json()).toEqual({ ok: true, applied: false });
    expect(await realStore.targets("owner", THREAD)).toEqual([]);
    const { activityId: next } = await (await reserve()).json();
    expect(next).toBeGreaterThan(activityId);
    state.activeSession = false;
    const denied = await reserve();
    expect(denied.status).toBe(401);
    state.activeSession = true;
    await realStore.saveToken("owner", token, "33333333-3333-4333-8333-333333333333", 2);
    expect(await (await reserve()).json()).toEqual({ activityId: null });
    await realStore.release(token, 3);
  });
  it("retains session error precedence over an unavailable membership read", async () => {
    const token = encodeWebPushSubscription({ endpoint: "https://web.push.apple.com/guard-precedence", keys: { p256dh: "public_key_material", auth: "secret_auth_material" } });
    const body = { action: "presence", presenceVersion: 2, token, conversationId: THREAD, activityId: 1, revision: 1 };
    state.membershipUnavailable = true;
    state.activeSession = false;
    expect((await POST(request(body))).status).toBe(401);
    state.activeSession = true;
    expect((await POST(request(body))).status).toBe(503);
    state.membershipUnavailable = false;
    state.member = false;
    expect((await POST(request(body))).status).toBe(404);
  });
  it("subscribes without requiring previously enabled preferences", async () => {
    const token = encodeWebPushSubscription({ endpoint: "https://web.push.apple.com/subscribe", keys: { p256dh: "public_key_material", auth: "secret_auth_material" } });
    const response = await POST(request({ action: "subscribe", token, sequence: 7 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, bound: true, sessionId: SESSION });
    expect(saveToken).toHaveBeenCalledWith("owner", token, SESSION, 7);
    expect(release).not.toHaveBeenCalled();
  });
  it.each([true, false])("sets a member's conversation mute to %s", async (muted) => {
    const response = await POST(request({ action: "mute", conversationId: THREAD, muted }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(setMuted).toHaveBeenCalledWith("owner", THREAD, muted);
  });
  it.each([
    null,
    [],
    {},
    { action: "unknown" },
    { action: "toString" },
    { action: "__proto__" },
    { action: "preferences", enabled: true, preview: "true" },
    { action: "mute", conversationId: THREAD, muted: "true" },
    { action: "subscribe", token: "invalid" },
    { action: "restore", token: "invalid" },
    { action: "subscribe", token: encodeWebPushSubscription({ endpoint: "https://web.push.apple.com/unordered", keys: { p256dh: "public_key_material", auth: "secret_auth_material" } }) },
    { action: "restore", token: encodeWebPushSubscription({ endpoint: "https://web.push.apple.com/unordered", keys: { p256dh: "public_key_material", auth: "secret_auth_material" } }), sequence: 1.5 },
    { action: "presence", token: "invalid", conversationId: null, activityId: 1, revision: 1 },
  ])("rejects malformed notification changes: %j", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    for (const write of [savePreferences, setMuted, saveToken, release, presence]) expect(write).not.toHaveBeenCalled();
  });
  it("maps a dispatched storage failure to the existing unavailable response", async () => {
    savePreferences.mockRejectedValueOnce(new Error("unavailable"));
    const response = await POST(request({ action: "preferences", enabled: true, preview: false }));
    expect(response.status).toBe(503);
  });
  it("scopes ordered presence to the verified session", async () => {
    const token = encodeWebPushSubscription({ endpoint: "https://web.push.apple.com/presence", keys: { p256dh: "public_key_material", auth: "secret_auth_material" } });
    expect((await POST(request({ action: "presence", presenceVersion: 2, token, conversationId: THREAD, activityId: 1, revision: 2, sessionId: "asserted" }))).status).toBe(200);
    expect(presence).toHaveBeenCalledWith("owner", token, THREAD, SESSION, 1, 2);
    state.member = false;
    expect((await POST(request({ action: "presence", presenceVersion: 2, token, conversationId: THREAD, activityId: 1, revision: 3 }))).status).toBe(404);
    expect(presence).toHaveBeenCalledTimes(1);
  });
  it("rejects installed clock-based clients before storage", async () => {
    const token = encodeWebPushSubscription({ endpoint: "https://web.push.apple.com/legacy", keys: { p256dh: "public_key_material", auth: "secret_auth_material" } });
    expect((await POST(request({ action: "presence", token, conversationId: THREAD, activityId: 1800000000000000, revision: 1 }))).status).toBe(400);
    expect(presence).not.toHaveBeenCalled();
  });
  it("rejects unordered presence instead of allowing a stale write", async () => {
    const token = encodeWebPushSubscription({ endpoint: "https://web.push.apple.com/presence", keys: { p256dh: "public_key_material", auth: "secret_auth_material" } });
    expect((await POST(request({ action: "presence", token, conversationId: null }))).status).toBe(400);
    expect(presence).not.toHaveBeenCalled();
  });
  it("refuses presence from a bearer that belongs to a different account", async () => {
    state.userId = "different-user";
    const token = encodeWebPushSubscription({ endpoint: "https://web.push.apple.com/presence", keys: { p256dh: "public_key_material", auth: "secret_auth_material" } });
    expect((await POST(request({ action: "presence", presenceVersion: 2, token, conversationId: null, activityId: 1, revision: 2 }))).status).toBe(401);
    expect(presence).not.toHaveBeenCalled();
  });
  it.each(["", "different-user"])("returns no preview before allocating a per-user limit for %s", async (userId) => {
    state.userId = userId;
    state.limited = true;
    const token = encodeWebPushSubscription({ endpoint: "https://web.push.apple.com/anonymous-preview", keys: { p256dh: "public_key_material", auth: "secret_auth_material" } });
    const response = await PUT(request({ token, recipientId: THREAD, conversationId: THREAD, messageId: THREAD }, "PUT"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ preview: null });
  });
  it("reconciles an existing device without clearing an enabled binding first", async () => {
    const token = encodeWebPushSubscription({ endpoint: "https://web.push.apple.com/restore", keys: { p256dh: "public_key_material", auth: "secret_auth_material" } });
    state.prefs.enabled = true;
    const restored = await POST(request({ action: "restore", token, sequence: 7 }));
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({ bound: true, sessionId: SESSION });
    expect(saveToken).toHaveBeenCalledWith("owner", token, SESSION, 7);
    expect(release).not.toHaveBeenCalled();
    state.prefs.enabled = false;
    expect((await POST(request({ action: "restore", token, sequence: 8 }))).status).toBe(200);
    expect(release).toHaveBeenCalledWith(token, 8);
  });
  it.each(["allowed", "muted"] as const)("keeps the toast quiet when %s forbids it", async (field) => {
    state[field] = field !== "allowed";
    const response = await GET(new Request(`https://pubmaxxing.com/api/message-notifications?conversationId=${THREAD}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ quiet: true });
  });
  it("allows a device holder to release its token after sign-out without selecting another owner", async () => {
    state.userId = "";
    const token = encodeWebPushSubscription({ endpoint: "https://web.push.apple.com/release", keys: { p256dh: "public_key_material", auth: "secret_auth_material" } });
    const detach = (body: unknown) => DELETE(new Request("https://pubmaxxing.com/api/message-notifications", { method: "DELETE", body: JSON.stringify(body) }));
    expect((await detach({ token, sessionId: SESSION })).status).toBe(400);
    expect(release).not.toHaveBeenCalled();
    const response = await detach({ token, sessionId: SESSION, sequence: 9 });
    expect(response.status).toBe(200);
    expect(release).toHaveBeenCalledWith(token, 9, SESSION);
  });
  it("refuses anonymous reads and writes without changing preferences", async () => {
    state.userId = "";
    expect((await GET(new Request("https://pubmaxxing.com/api/message-notifications"))).status).toBe(401);
    expect((await POST(request({ action: "preferences", enabled: true, preview: true }))).status).toBe(401);
    expect(savePreferences).not.toHaveBeenCalled();
  });
  it("stores preferences against the verified caller rather than an asserted owner", async () => {
    expect((await POST(request({ action: "preferences", userId: "stranger", enabled: true, preview: false }))).status).toBe(200);
    expect(savePreferences).toHaveBeenCalledWith("owner", { enabled: true, preview: false });
  });
  it("does not reveal or mute an outsider's thread", async () => {
    state.member = false;
    expect((await GET(new Request(`https://pubmaxxing.com/api/message-notifications?conversationId=${THREAD}`))).status).toBe(404);
    expect((await POST(request({ action: "mute", conversationId: THREAD, muted: true }))).status).toBe(404);
    expect(setMuted).not.toHaveBeenCalled();
  });
  it("limits writes before storage", async () => {
    state.limited = true;
    expect((await POST(request({ action: "preferences", enabled: true, preview: false }))).status).toBe(429);
    expect(savePreferences).not.toHaveBeenCalled();
  });
  it("rejects invalid subscriptions instead of registering a network destination", async () => {
    expect((await POST(request({ action: "subscribe", token: "https://127.0.0.1/private" }))).status).toBe(400);
  });
});

it("loads thread settings without requiring a message-policy read", async () => {
  state.prefs.enabled = true;
  state.latestUnavailable = true;
  const response = await GET(new Request(`https://pubmaxxing.com/api/message-notifications?conversationId=${THREAD}&settingsOnly=1`));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ enabled: true, preview: false, muted: false, registered: false });
});
