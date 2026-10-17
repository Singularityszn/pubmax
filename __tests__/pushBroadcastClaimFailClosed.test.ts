import { describe, expect, it, vi } from "vitest";

import type { PerTokenResult, PushProvider } from "@/lib/pushProvider";

// The night-signal broadcast claim is the only thing standing between one
// snapshot version and a duplicate push to every device from every warm
// instance. When the durable limiter cannot answer, isLimited fails OPEN to a
// per-instance budget unless the caller asks it to fail closed. This stands in
// for that outage: a fail-closed caller is refused, anyone else is let through.

const { sendMock, isLimitedMock } = vi.hoisted(() => ({
  sendMock: vi.fn<PushProvider["send"]>(async (tokens) =>
    tokens.map((token) => ({ token, status: "sent" }) as PerTokenResult),
  ),
  isLimitedMock: vi.fn(
    async (
      _localKey: string,
      _durableKey: string,
      _limit?: number,
      _windowMs?: number,
      opts?: { failClosed?: boolean },
    ) => opts?.failClosed === true,
  ),
}));

vi.mock("@/lib/pushProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pushProvider")>();
  return { ...actual, selectPushProvider: () => ({ send: sendMock }) };
});
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: isLimitedMock };
});

import { maybeBroadcastNightSignalLive } from "@/lib/pushSender";
import { memoryPushTokenStore } from "@/lib/pushTokenStore";

describe("night-signal broadcast claim during a limiter outage", () => {
  it("drops the broadcast rather than letting each instance win its own claim", async () => {
    await memoryPushTokenStore.save({ token: "tok-outage", platform: "ios" });
    const summary = await maybeBroadcastNightSignalLive("2026-10-16T22:00:00.000Z", [
      { id: "sig-1", title: "The Anchor", body: "Late licence tonight", entityId: "venue-anchor" },
    ]);
    expect(isLimitedMock).toHaveBeenCalledWith(
      "night-signal-broadcast:2026-10-16T22:00:00.000Z",
      "night-signal-broadcast:2026-10-16T22:00:00.000Z",
      1,
      expect.any(Number),
      { failClosed: true },
    );
    expect(summary.targeted).toBe(0);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
