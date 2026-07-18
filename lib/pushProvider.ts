// Push delivery seam. ONE interface, TWO implementations — a no-op that is
// active until APNs credentials exist, and the real APNs sender that speaks
// HTTP/2 to Apple. Selection mirrors the env-based store seam
// (lib/storeBackend.ts selectStore): the moment the APNs env keys land,
// selectPushProvider() flips to the real sender with no caller change.
//
// No APNs SDK is a dependency. apnsPushProvider speaks HTTP/2 (node:http2) to
// api.push.apple.com with an ES256 provider JWT (node:crypto) signed from
// APNS_PRIVATE_KEY — APNS_KEY_ID in the JWT header (`kid`), APNS_TEAM_ID as the
// issuer (`iss`), the bundle id as `apns-topic`. The JWT is signed once and
// reused for up to ~50 min (Apple rejects tokens refreshed too often AND tokens
// older than an hour, so a single ~50-min window threads both limits). The
// transport is injected (a session factory) so it is fully unit-testable
// against a mock without a live APNs connection.

import { createPrivateKey, sign as cryptoSign } from "node:crypto";
import { connect as http2Connect, constants as http2Constants } from "node:http2";

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

// ── APNs transport ───────────────────────────────────────────────────────────

/** Resolved APNs credentials + target host for one send. */
export type ApnsConfig = {
  keyId: string;
  teamId: string;
  privateKey: string;
  /** api.push.apple.com (production) or api.sandbox.push.apple.com. */
  host: string;
};

/** One request to send over a session. */
export type ApnsRequest = {
  deviceToken: string;
  headers: Record<string, string>;
  body: string;
};

/** The parsed shape of an APNs HTTP/2 response — the only thing send() maps. */
export type ApnsRawResponse = {
  /** HTTP `:status` (200 delivered; 410 unregistered; 429/5xx retryable). */
  status: number;
  /** APNs `apns-id` echo, for correlating delivery in logs. */
  apnsId?: string;
  /** `reason` from the JSON error body, e.g. "BadDeviceToken"/"Unregistered". */
  reason?: string;
};

/** A live HTTP/2 conversation with APNs — one per send() batch, multiplexing
 *  every token's request, then closed. Injected so tests need no real socket. */
export interface ApnsTransport {
  send(request: ApnsRequest): Promise<ApnsRawResponse>;
  close(): void;
}

/** Opens a transport to `host`. The real one wraps node:http2; tests pass a
 *  fake. May throw synchronously (connection refused) → whole batch errors. */
export type ApnsSessionFactory = (host: string) => ApnsTransport;

/** Injectable seams — all default to production behaviour. */
export type ApnsProviderDeps = {
  /** Transport opener. Defaults to a node:http2 session per batch. */
  sessionFactory?: ApnsSessionFactory;
  /** Millisecond clock, for the JWT `iat` and its reuse window. */
  now?: () => number;
  /** Credential resolver. Defaults to reading the APNS_* env. */
  config?: () => ApnsConfig;
  /** Signed-JWT cache. Defaults to a shared module-level cache. */
  jwtCache?: Map<string, JwtCacheEntry>;
};

type JwtCacheEntry = { token: string; iatMs: number };

// Reuse a signed provider JWT for up to 50 min. Apple rejects a token used
// within ~20 min of the previous refresh (TooManyProviderTokenUpdates) AND any
// token older than 1 h (ExpiredProviderToken) — 50 min sits comfortably inside
// both bounds.
const JWT_REUSE_MS = 50 * 60 * 1000;

const APNS_TOPIC = APNS_BUNDLE_ID;
const moduleJwtCache = new Map<string, JwtCacheEntry>();

function base64url(input: string | Buffer): string {
  return (typeof input === "string" ? Buffer.from(input, "utf8") : input).toString("base64url");
}

/**
 * Build a signed APNs provider JWT (ES256). Header carries `alg`+`kid`; claims
 * carry `iss`(team)+`iat`. The ECDSA signature is emitted in JOSE raw r‖s form
 * (`dsaEncoding: "ieee-p1363"`) — NOT DER — which is what APNs (and every JWT
 * verifier) expects. Throws if the private key cannot be parsed.
 */
export function buildApnsJwt(params: {
  keyId: string;
  teamId: string;
  privateKey: string;
  /** Issued-at, unix SECONDS. */
  iat: number;
}): string {
  const header = base64url(JSON.stringify({ alg: "ES256", kid: params.keyId }));
  const claims = base64url(JSON.stringify({ iss: params.teamId, iat: params.iat }));
  const signingInput = `${header}.${claims}`;
  const key = createPrivateKey(params.privateKey);
  const signature = cryptoSign("sha256", Buffer.from(signingInput, "utf8"), {
    key,
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${base64url(signature)}`;
}

function getCachedJwt(config: ApnsConfig, nowMs: number, cache: Map<string, JwtCacheEntry>): string {
  const cacheKey = `${config.keyId}:${config.teamId}`;
  const cached = cache.get(cacheKey);
  if (cached && nowMs - cached.iatMs < JWT_REUSE_MS) return cached.token;
  const token = buildApnsJwt({
    keyId: config.keyId,
    teamId: config.teamId,
    privateKey: config.privateKey,
    iat: Math.floor(nowMs / 1000),
  });
  cache.set(cacheKey, { token, iatMs: nowMs });
  return token;
}

/** Read + validate APNs env into a config. Throws (loud) if a key is missing —
 *  callers only reach here once isApnsConfigured() is true. `APNS_ENV` selects
 *  the host; sandbox is the default (safer for the first TestFlight build). */
function resolveApnsConfig(): ApnsConfig {
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const privateKey = process.env.APNS_PRIVATE_KEY;
  if (!keyId || !teamId || !privateKey) {
    throw new Error(
      "apnsPushProvider: APNS_KEY_ID, APNS_TEAM_ID and APNS_PRIVATE_KEY must all be set.",
    );
  }
  const host = process.env.APNS_ENV === "production"
    ? "api.push.apple.com"
    : "api.sandbox.push.apple.com";
  return { keyId, teamId, privateKey, host };
}

/** Map one APNs HTTP/2 response to a PerTokenResult. 200 → sent; 410 or a
 *  BadDeviceToken/Unregistered reason → invalid (the caller prunes it);
 *  429/5xx and every other failure → error (retryable). */
function mapApnsResponse(token: string, res: ApnsRawResponse): PerTokenResult {
  if (res.status === 200) return { token, status: "sent" };
  if (res.status === 410 || res.reason === "Unregistered" || res.reason === "BadDeviceToken") {
    return { token, status: "invalid", reason: res.reason ?? `apns_${res.status}` };
  }
  return { token, status: "error", reason: res.reason ?? `apns_${res.status}` };
}

/** The real node:http2 transport: one session to `https://{host}`, each token
 *  a POST stream to /3/device/{token}. Not exercised by unit tests (no live
 *  APNs); kept deliberately thin so the tested seam is the injected factory. */
function realApnsSessionFactory(host: string): ApnsTransport {
  const session = http2Connect(`https://${host}`);
  // A session-level error (TLS, GOAWAY, socket drop) rejects every in-flight
  // request via their own 'error' listeners; swallow here so it is not an
  // unhandled 'error' event on the session itself.
  session.on("error", () => {});
  return {
    send({ deviceToken, headers, body }) {
      return new Promise<ApnsRawResponse>((resolve, reject) => {
        const stream = session.request({
          [http2Constants.HTTP2_HEADER_METHOD]: "POST",
          [http2Constants.HTTP2_HEADER_PATH]: `/3/device/${deviceToken}`,
          ...headers,
        });
        let status = 0;
        let apnsId: string | undefined;
        const chunks: Buffer[] = [];
        stream.on("response", (h) => {
          status = Number(h[http2Constants.HTTP2_HEADER_STATUS]) || 0;
          const id = h["apns-id"];
          apnsId = Array.isArray(id) ? id[0] : (id as string | undefined);
        });
        stream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        stream.on("end", () => {
          let reason: string | undefined;
          const raw = Buffer.concat(chunks).toString("utf8");
          if (raw) {
            try {
              reason = (JSON.parse(raw) as { reason?: string }).reason;
            } catch {
              // Non-JSON body (unexpected) — status still drives the mapping.
            }
          }
          resolve({ status, apnsId, reason });
        });
        stream.on("error", reject);
        stream.end(body);
      });
    },
    close() {
      session.close();
    },
  };
}

/** Serialise a provider-agnostic payload into the APNs `aps` envelope, with the
 *  routing `data` riding as top-level custom keys (Apple reserves `aps`). */
function buildApnsBody(payload: PushPayload): string {
  const aps: Record<string, unknown> = {
    alert: { title: payload.title, body: payload.body },
    sound: "default",
  };
  if (payload.threadId) aps["thread-id"] = payload.threadId;
  return JSON.stringify({ aps, ...(payload.data ?? {}) });
}

async function sendOne(
  transport: ApnsTransport,
  token: string,
  jwt: string,
  body: string,
): Promise<PerTokenResult> {
  const headers: Record<string, string> = {
    authorization: `bearer ${jwt}`,
    "apns-topic": APNS_TOPIC,
    "apns-push-type": "alert",
    "apns-priority": "10",
  };
  let res: ApnsRawResponse;
  try {
    res = await transport.send({ deviceToken: token, headers, body });
  } catch (err) {
    // Connection-level / stream failure for THIS request → retryable error.
    console.error(
      `[pushProvider:apns] request failed for token …${token.slice(-6)}:`,
      err instanceof Error ? err.message : String(err),
    );
    return { token, status: "error", reason: "apns_request_failed" };
  }
  const result = mapApnsResponse(token, res);
  if (result.status !== "sent") {
    console.info(
      `[pushProvider:apns] token …${token.slice(-6)} → ${result.status} (${result.reason}) apns-id=${res.apnsId ?? "-"}`,
    );
  }
  return result;
}

/**
 * Build an APNs provider bound to the given seams (transport, clock, config,
 * JWT cache). The exported `apnsPushProvider` is this with production defaults;
 * tests construct their own with a mock session factory + fixed clock.
 *
 * Contract (matches PushProvider): resolves one result per input token in input
 * order; per-token transport failures are results, not throws. A *config*
 * failure (missing/unparseable key) DOES throw — that is a loud misconfiguration
 * the fan-out (lib/pushSender.ts) catches into an all-error summary.
 */
export function createApnsPushProvider(deps: ApnsProviderDeps = {}): PushProvider {
  const sessionFactory = deps.sessionFactory ?? realApnsSessionFactory;
  const now = deps.now ?? Date.now;
  const resolveConfig = deps.config ?? resolveApnsConfig;
  const jwtCache = deps.jwtCache ?? moduleJwtCache;

  return {
    async send(tokens, payload) {
      if (tokens.length === 0) return [];
      // Throws on misconfiguration (missing keys) — loud by design.
      const config = resolveConfig();
      // Signing failure (bad p8) is also a config error → throw, don't mask it
      // as per-token noise.
      const jwt = getCachedJwt(config, now(), jwtCache);
      const body = buildApnsBody(payload);

      let transport: ApnsTransport;
      try {
        transport = sessionFactory(config.host);
      } catch (err) {
        // Could not even open the connection → the whole batch is a retryable
        // error (never invalid — we must not prune tokens on our own outage).
        console.error(
          `[pushProvider:apns] could not open session to ${config.host}:`,
          err instanceof Error ? err.message : String(err),
        );
        return tokens.map((token) => ({ token, status: "error", reason: "apns_connect_failed" }));
      }

      try {
        // Multiplex every token over the one session, preserving input order.
        return await Promise.all(tokens.map((token) => sendOne(transport, token, jwt, body)));
      } finally {
        try {
          transport.close();
        } catch {
          // Best-effort close; results are already resolved.
        }
      }
    },
  };
}

/**
 * APNs sender. Active once APNS_KEY_ID / APNS_TEAM_ID / APNS_PRIVATE_KEY exist;
 * speaks HTTP/2 to Apple with an ES256 provider JWT. Uses production defaults
 * (real node:http2 transport, wall clock, env credentials).
 */
export const apnsPushProvider: PushProvider = createApnsPushProvider();

/** Single selection point (mirrors lib/storeBackend.ts selectStore): real APNs
 *  when its env keys exist, the no-op otherwise. */
export function selectPushProvider(): PushProvider {
  return isApnsConfigured() ? apnsPushProvider : noopPushProvider;
}
