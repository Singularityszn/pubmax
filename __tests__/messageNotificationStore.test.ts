import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { memoryMessageNotificationStore as store } from "@/lib/messageNotificationStore";
import { encodeWebPushSubscription } from "@/lib/webPushSubscription";

function token(id: string, auth = "secret_auth_key") {
  return encodeWebPushSubscription({ endpoint: `https://web.push.apple.com/${id}`, keys: { p256dh: "public_key_material", auth } })!;
}
afterEach(() => vi.restoreAllMocks());

describe("message device ownership and foreground presence", () => {
  it("suppresses only the same visible thread for thirty seconds", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(100_000);
    const device = token("presence");
    await store.saveToken("presence-user", device, "session");
    await store.presence("presence-user", device, "thread-a");
    expect(await store.targets("presence-user", "thread-a")).toEqual([]);
    expect(await store.targets("presence-user", "thread-b")).toEqual([device]);
    now.mockReturnValue(130_001);
    expect(await store.targets("presence-user", "thread-a")).toEqual([device]);
    await store.presence("presence-user", device, null);
    expect(await store.targets("presence-user", "thread-a")).toEqual([device]);
  });
  it("does not let another account mark a device present or remove it", async () => {
    const device = token("owner-only");
    await store.saveToken("owner", device, "session");
    await store.presence("outsider", device, "thread");
    await store.removeToken("outsider", device);
    expect(await store.targets("owner", "thread")).toEqual([device]);
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
