import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  enabled: true, preview: false, threadMuted: false, socialMuted: false, pairBlocked: false, recipientBlocked: false, duplicate: false, present: false,
  bound: true, live: true, body: "a".repeat(300),
  send: vi.fn(async () => []),
}));
vi.mock("@/lib/messageNotificationStore", () => ({ messageNotificationStore: () => ({
  preferences: async () => ({ enabled: state.enabled, preview: state.preview }),
  muted: async () => state.threadMuted,
  targets: async () => state.present ? [] : ["recipient-token"],
  removeToken: vi.fn(),
  claim: async () => !state.duplicate,
  previewAllowed: async () => state.bound,
  sessionActive: async () => state.live,
}) }));
vi.mock("@/lib/pushProvider", () => ({ selectPushProvider: () => ({ send: state.send }) }));
vi.mock("@/lib/profileStore", () => ({
  isProfileTombstoned: () => false,
  profileStore: () => ({ getByHandle: async (handle: string) => ({ id: handle, handle, userId: `user-${handle}` }), getHandleByUserId: async () => "ken" }),
}));
vi.mock("@/lib/socialInteractionStore", () => ({ socialInteractionStore: () => ({
  relationship: async () => ({ blocked: state.recipientBlocked, muted: state.socialMuted }),
}) }));
vi.mock("@/lib/messageSafety.server", () => ({ messageBlockRefusal: async () => state.pairBlocked ? new Response(null, { status: 403 }) : null }));
vi.mock("@/lib/messagesStore", () => ({ messagesStore: () => ({
  membership: async () => ({ handles: ["sam", "ken"], kind: "direct", title: null }),
  listMessages: async () => [{ id: "m1", senderHandle: "sam", body: state.body, read: false, flagged: false }],
}) }));

import { notifyMessageRecipients, resolveMessageNotificationPreview } from "@/lib/messageNotifications.server";

const message = { id: "m1", conversationId: "c1", senderHandle: "sam", body: "Private words", createdAt: new Date().toISOString(), read: false, flagged: false };

beforeEach(() => {
  Object.assign(state, { enabled: true, preview: false, threadMuted: false, socialMuted: false, pairBlocked: false, recipientBlocked: false, duplicate: false, present: false });
  state.bound = true;
  state.live = true;
  state.body = "a".repeat(300);
  state.send.mockClear();
});

describe("private message push", () => {
  it("targets only the recipient and omits message content by default", async () => {
    await notifyMessageRecipients(message);
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.send).toHaveBeenCalledWith(["recipient-token"], expect.objectContaining({
      title: "New message", body: "Open PubMaxxing to read it.",
      data: expect.objectContaining({ recipientId: "user-ken", url: "/messages/c1" }),
    }));
    expect(JSON.stringify(state.send.mock.calls)).not.toContain("Private words");
  });

  it("keeps transport payloads private and resolves a short preview only for the current device", async () => {
    state.preview = true;
    await notifyMessageRecipients({ ...message, body: "a".repeat(300) });
    expect(state.send).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ title: "New message", body: "Open PubMaxxing to read it.", data: expect.objectContaining({ preview: "1", messageId: "m1" }) }));
    expect(await resolveMessageNotificationPreview("token", "user-ken", "c1", "m1", "session")).toEqual({ title: "@sam", body: "a".repeat(80) });
    state.bound = false;
    expect(await resolveMessageNotificationPreview("token", "user-ken", "c1", "m1", "session")).toBeNull();
  });

  it("returns no preview when a still-valid access token belongs to a revoked session", async () => {
    state.preview = true;
    state.live = false;
    expect(await resolveMessageNotificationPreview("token", "user-ken", "c1", "m1", "revoked-session")).toBeNull();
  });
  it("does not cut an emoji in a permitted preview", async () => {
    state.preview = true;
    state.body = `${"a".repeat(79)}🍺word`;
    expect((await resolveMessageNotificationPreview("token", "user-ken", "c1", "m1", "session"))?.body).toBe(`${"a".repeat(79)}🍺`);
  });

  it.each(["enabled", "threadMuted", "socialMuted", "pairBlocked", "recipientBlocked", "duplicate", "present"] as const)("does not deliver when %s prevents it", async (key) => {
    state[key] = key !== "enabled";
    await notifyMessageRecipients(message);
    expect(state.send).not.toHaveBeenCalled();
  });

  it("does not notify for removed or reported messages", async () => {
    await notifyMessageRecipients({ ...message, unsent: true });
    await notifyMessageRecipients({ ...message, flagged: true });
    expect(state.send).not.toHaveBeenCalled();
  });
});
