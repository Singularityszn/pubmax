import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  enabled: true, preview: false, muted: false, blocked: false, duplicate: false,
  send: vi.fn(async () => []),
}));
vi.mock("@/lib/messageNotificationStore", () => ({ messageNotificationStore: () => ({
  preferences: async () => ({ enabled: state.enabled, preview: state.preview }),
  muted: async () => state.muted,
  tokens: async () => ["recipient-token"],
  removeToken: vi.fn(),
}) }));
vi.mock("@/lib/pushProvider", () => ({ selectPushProvider: () => ({ send: state.send }) }));
vi.mock("@/lib/pintDrops", () => ({ isLimited: async () => state.duplicate }));
vi.mock("@/lib/profileStore", () => ({
  isProfileTombstoned: () => false,
  profileStore: () => ({ getByHandle: async (handle: string) => ({ id: handle, handle, userId: `user-${handle}` }) }),
}));
vi.mock("@/lib/socialInteractionStore", () => ({ socialInteractionStore: () => ({
  relationship: async () => ({ blocked: state.blocked, muted: state.muted }),
}) }));
vi.mock("@/lib/messageSafety.server", () => ({ messageBlockRefusal: async () => state.blocked ? new Response(null, { status: 403 }) : null }));
vi.mock("@/lib/messagesStore", () => ({ messagesStore: () => ({
  membership: async () => ({ handles: ["sam", "ken"], kind: "direct", title: null }),
}) }));

import { notifyMessageRecipients } from "@/lib/messageNotifications.server";

const message = { id: "m1", conversationId: "c1", senderHandle: "sam", body: "Private words", createdAt: new Date().toISOString(), read: false, flagged: false };

beforeEach(() => {
  Object.assign(state, { enabled: true, preview: false, muted: false, blocked: false, duplicate: false });
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

  it("includes only a short preview after explicit permission", async () => {
    state.preview = true;
    await notifyMessageRecipients({ ...message, body: "a".repeat(300) });
    expect(state.send).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ title: "@sam", body: "a".repeat(80) }));
  });

  it.each(["enabled", "muted", "blocked", "duplicate"] as const)("does not deliver when %s prevents it", async (key) => {
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
