import { describe, expect, it } from "vitest";

import {
  decodeWebPushSubscription,
  encodeWebPushSubscription,
  isWebPushToken,
  validateWebPushSubscription,
} from "@/lib/webPushSubscription";

const SUBSCRIPTION = {
  endpoint: "https://updates.push.services.mozilla.com/wpush/v2/example",
  expirationTime: null,
  keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
};

describe("web push subscription codec", () => {
  it("round-trips the browser JSON as one opaque, bounded token", () => {
    const token = encodeWebPushSubscription(SUBSCRIPTION)!;
    expect(isWebPushToken(token)).toBe(true);
    expect(token.length).toBeLessThan(2_048);
    expect(decodeWebPushSubscription(token)).toEqual(SUBSCRIPTION);
  });

  it("rejects insecure endpoints, credentials, malformed keys and corrupt tokens", () => {
    expect(validateWebPushSubscription({ ...SUBSCRIPTION, endpoint: "http://push.example/x" })).toBeNull();
    expect(validateWebPushSubscription({ ...SUBSCRIPTION, endpoint: "https://user:pass@push.example/x" })).toBeNull();
    expect(validateWebPushSubscription({ ...SUBSCRIPTION, keys: { p256dh: "no spaces", auth: "B".repeat(22) } })).toBeNull();
    expect(decodeWebPushSubscription("webpush:not-base64-json")).toBeNull();
    expect(decodeWebPushSubscription("native-token")).toBeNull();
  });
});
