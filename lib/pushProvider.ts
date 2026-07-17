// Push delivery seam. ONE interface, TWO implementations — a no-op that is
// active until APNs credentials exist, and an APNs stub whose SHAPE is final
// but whose HTTP/2 + JWT body is a deliberate later drop. Selection mirrors the
// env-based store seam (lib/storeBackend.ts selectStore): the moment the APNs
// env keys land, selectPushProvider() flips to the real sender with no caller
// change.
//
// No APNs SDK is a dependency yet. The real apnsPushProvider will speak HTTP/2
// to api.push.apple.com with a per-request ES256 JWT signed from
// APNS_PRIVATE_KEY (APNS_KEY_ID / APNS_TEAM_ID in the header/claims) and the
// bundle id as the apns-topic. That is intentionally NOT implemented here.

/** Bundle id (apns-topic) for the Capacitor shell — see docs/CAPACITOR_WRAP.md. */
export const APNS_BUNDLE_ID = "com.pubmaxx.app";

/** A notification body, provider-agnostic. `data` rides the APNs custom keys. */
export type PushPayload = {
  title: string;
  body: string;
  /** Deep-link / routing hints delivered as APNs custom data keys. */
  data?: Record<string, string>;
  /** APNs `thread-id` — groups related notifications in the tray. */
  threadId?: string;
};

/** Terminal disposition of a single token in a send. `invalid` tokens are
 *  pruned by the caller (APNs 410 / BadDeviceToken); `error` is retryable. */
export type PushDeliveryStatus = "sent" | "skipped" | "invalid" | "error";

export type PerTokenResult = {
  token: string;
  status: PushDeliveryStatus;
  /** Human-readable cause for skipped/invalid/error — never a secret. */
  reason?: string;
};

export interface PushProvider {
  /** Deliver `payload` to each token. Resolves one result per input token,
   *  in input order; never throws for a per-token failure (that is a result). */
  send(tokens: readonly string[], payload: PushPayload): Promise<PerTokenResult[]>;
}

/** The env keys the real APNs sender needs. All must be present to go live. */
export function isApnsConfigured(): boolean {
  return Boolean(
    process.env.APNS_KEY_ID
      && process.env.APNS_TEAM_ID
      && process.env.APNS_PRIVATE_KEY,
  );
}

/**
 * Active until APNs credentials exist. Logs the count once and reports every
 * token as `skipped` — a truthful "nothing was delivered" the fan-out can
 * summarise without special-casing. Never prunes tokens.
 */
export const noopPushProvider: PushProvider = {
  async send(tokens, payload) {
    if (tokens.length > 0) {
      console.info(
        `[pushProvider:noop] would deliver "${payload.title}" to ${tokens.length} token(s) — APNs not configured, skipping.`,
      );
    }
    return tokens.map((token) => ({ token, status: "skipped", reason: "apns_not_configured" }));
  },
};

/**
 * APNs sender — STUB. The env is read and validated so a misconfiguration
 * fails loud, but the HTTP/2 + JWT delivery is the later drop-in. Reaching
 * send() means selectPushProvider() chose APNs (keys present) yet the transport
 * is not wired, so it throws a clear, actionable error rather than silently
 * dropping notifications.
 */
export const apnsPushProvider: PushProvider = {
  async send() {
    if (!isApnsConfigured()) {
      throw new Error(
        "apnsPushProvider: APNS_KEY_ID, APNS_TEAM_ID and APNS_PRIVATE_KEY must all be set.",
      );
    }
    throw new Error(
      "apnsPushProvider: APNs HTTP/2 delivery is not implemented yet (credentials present but transport is a pending drop-in). See lib/pushProvider.ts.",
    );
  },
};

/** Single selection point (mirrors lib/storeBackend.ts selectStore): real APNs
 *  when its env keys exist, the no-op otherwise. */
export function selectPushProvider(): PushProvider {
  return isApnsConfigured() ? apnsPushProvider : noopPushProvider;
}
