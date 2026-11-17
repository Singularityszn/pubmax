import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { memoryMessageNotificationStore as store } from "@/lib/messageNotificationStore";
import { encodeWebPushSubscription } from "@/lib/webPushSubscription";

function token(id: string, auth = "secret_auth_key") {
  return encodeWebPushSubscription({ endpoint: `https://web.push.apple.com/${id}`, keys: { p256dh: "public_key_material", auth } })!;
}
afterEach(() => vi.restoreAllMocks());

describe("message device ownership and foreground presence", () => {
  it("preserves B when A's delayed clear arrives and refuses the older heartbeat", async () => {
    const device = token("ordered-presence");
    await store.saveToken("ordered-user", device, "session");
    await store.presence("ordered-user", device, "thread-a", "session", 1, 1);
    await store.presence("ordered-user", device, "thread-b", "session", 2, 3);
    await store.presence("ordered-user", device, null, "session", 1, 4);
    await store.presence("ordered-user", device, "thread-a", "session", 1, 2);
    expect(await store.targets("ordered-user", "thread-b")).toEqual([]);
    expect(await store.targets("ordered-user", "thread-a")).toEqual([device]);
  });
  it("keeps a clear authoritative when its older heartbeat arrives afterwards", async () => {
    const device = token("hidden-presence");
    await store.saveToken("hidden-user", device, "session");
    await store.presence("hidden-user", device, null, "session", 1, 2);
    await store.presence("hidden-user", device, "thread", "session", 1, 1);
    expect(await store.targets("hidden-user", "thread")).toEqual([device]);
    await store.saveToken("hidden-user", device, "new-session");
    await store.presence("hidden-user", device, "thread", "session", 1, 3);
    expect(await store.targets("hidden-user", "thread")).toEqual([device]);
    await store.presence("hidden-user", device, "thread", "new-session", 2, 4);
    expect(await store.targets("hidden-user", "thread")).toEqual([]);
  });
  it("accepts a newer activity even when an older activity cleared first with a higher revision", async () => {
    const device = token("newer-activity");
    await store.saveToken("activity-user", device, "session");
    await store.presence("activity-user", device, null, "session", 1, 10);
    await store.presence("activity-user", device, "thread", "session", 2, 1);
    expect(await store.targets("activity-user", "thread")).toEqual([]);
  });
  it("accepts a verified well-formed memory session before its first device binding", async () => {
    expect(await store.sessionActive("new-user", "77777777-7777-4777-8777-777777777777")).toBe(true);
    expect(await store.tokens("new-user")).toEqual([]);
    expect(await store.sessionActive("new-user", "not-a-session")).toBe(false);
  });
  it("suppresses only the same visible thread for thirty seconds", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(100_000);
    const device = token("presence");
    await store.saveToken("presence-user", device, "session");
    await store.presence("presence-user", device, "thread-a", "session", 1, 1);
    expect(await store.targets("presence-user", "thread-a")).toEqual([]);
    expect(await store.targets("presence-user", "thread-b")).toEqual([device]);
    now.mockReturnValue(130_001);
    expect(await store.targets("presence-user", "thread-a")).toEqual([device]);
    await store.presence("presence-user", device, null, "session", 1, 2);
    expect(await store.targets("presence-user", "thread-a")).toEqual([device]);
  });
  it("does not let another account mark a device present or remove it", async () => {
    const device = token("owner-only");
    await store.saveToken("owner", device, "session");
    await store.presence("outsider", device, "thread", "session", 1, 1);
    await store.removeToken("outsider", device);
    expect(await store.targets("owner", "thread")).toEqual([device]);
  });
  it("keeps fresh thread presence on a same-session restore and clears it on a session change", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(100_000);
    const device = token("restore-presence");
    await store.saveToken("restoring-owner", device, "session-a");
    await store.presence("restoring-owner", device, "thread", "session-a", 1, 1);
    now.mockReturnValue(110_000);
    await store.saveToken("restoring-owner", device, "session-a");
    expect(await store.targets("restoring-owner", "thread")).toEqual([]);
    now.mockReturnValue(130_001);
    expect(await store.targets("restoring-owner", "thread")).toEqual([device]);
    await store.presence("restoring-owner", device, "thread", "session-a", 1, 2);
    await store.saveToken("restoring-owner", device, "session-b");
    expect(await store.targets("restoring-owner", "thread")).toEqual([device]);
  });
  it("does not let a stale session detach a newer account binding", async () => {
    const device = token("stale-session");
    await store.saveToken("A", device, "session-a");
    await store.saveToken("B", device, "session-b");
    await store.release(device, "session-a");
    expect(await store.tokens("B")).toEqual([device]);
  });
  it("does not overwrite another device using only its endpoint", async () => {
    const device = token("endpoint-only");
    await store.saveToken("victim", device, "session");
    await expect(store.saveToken("outsider", token("endpoint-only", "wrong_secret_key"), "session")).rejects.toThrow();
    expect(await store.tokens("victim")).toEqual([device]);
  });
  it("releases only the exact secret, then moves ownership A to B to A", async () => {
    const device = token("account-switch");
    await store.savePreferences("account-a", { enabled: true, preview: false });
    await store.saveToken("account-a", device, "session");
    await store.release(token("account-switch", "wrong_secret_key"));
    expect(await store.tokens("account-a")).toEqual([device]);
    await store.release(device);
    expect(await store.tokens("account-a")).toEqual([]);
    await store.saveToken("account-b", device, "session");
    expect(await store.tokens("account-a")).toEqual([]);
    await store.release(device);
    await store.saveToken("account-a", device, "session");
    expect(await store.tokens("account-b")).toEqual([]);
    expect(await store.tokens("account-a")).toEqual([device]);
    expect(await store.preferences("account-a")).toEqual({ enabled: true, preview: false });
  });
});
