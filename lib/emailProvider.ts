// Email delivery seam. ONE interface, TWO implementations: a no-op that is
// active until email-provider credentials exist, and the Resend sender.
// Selection mirrors the env-based store seam (lib/storeBackend.ts selectStore)
// and the push seam (lib/pushProvider.ts selectPushProvider): once
// RESEND_API_KEY and a verified EMAIL_FROM are both set, selectEmailProvider()
// returns the real sender with no caller change.
//
// PROVIDER DECISION (owner): Resend is the recommended default. It has a
// first-class transactional API, a generous free tier, a single-endpoint HTTP
// send, and DKIM/SPF through a verified domain (hello@pubmaxxing.com is on the
// owner queue). Postmark is the documented alternative: same seam, only
// isResend* / resendEmailProvider swap for Postmark equivalents (POST
// https://api.postmarkapp.com/email, header `X-Postmark-Server-Token`, JSON
// { From, To, Subject, HtmlBody, TextBody }). No email SDK is a dependency.
//
// THE RESEND TRANSPORT. One POST to https://api.resend.com/emails per message,
// sent one after another and never in parallel, because Resend limits requests
// per team. Each request carries:
//   headers: Authorization: Bearer <RESEND_API_KEY>, Content-Type, User-Agent
//            (Resend refuses a request without one), and Idempotency-Key when
//            the message carries a key
//   body:    { from: EMAIL_FROM, to: [msg.to], subject, html, text,
//              reply_to?, headers? }
// and a deadline (RESEND_REQUEST_TIMEOUT_MS) that an AbortController enforces.
// Each answer maps to ONE result:
//   2xx                                       -> sent, with the Resend id
//   400 or 422 validation_error on `to`       -> invalid (caller suppresses)
//   any other answer, a timeout, a network failure -> error (retryable)
// A refusal about US (a bad key, an unverified sender domain, a payload
// mistake, a spent quota) is `error`, never `invalid`: suppressing a good
// address for our own fault is the worse mistake. A timeout can follow a send
// Resend accepted, so a caller that retries an `error` passes an
// idempotencyKey and Resend sends that message once.
//
// LOGS never carry the API key or a full recipient address. A recipient is
// logged masked (lib/authSessionResume.ts maskEmail), the key value is cut out
// of any error text before it is logged, Resend's own error message is never
// logged (it can echo an address), and lib/log.ts scrubs a Bearer value as a
// second line of defence.

import { maskEmail } from "@/lib/authSessionResume";
import type { DeliveryStatus } from "@/lib/deliveryStatus";
import { isValidEmail } from "@/lib/emailAddress";
import { isEmailProviderConfigured } from "@/lib/emailProviderConfigured.mjs";
import { log } from "@/lib/log";

/** The one Resend endpoint this seam calls. Fixed, so a key can never be
 *  forwarded to another host. */
export const RESEND_SEND_URL = "https://api.resend.com/emails";

/** Per-request deadline, covering the request and its response. */
const RESEND_REQUEST_TIMEOUT_MS = 10_000;

const RESEND_USER_AGENT = "PUBMAXX-email/1";

/** A single email, provider-agnostic. Rendered HTML + a plain-text alternative
 *  (both required: every message ships a text/plain part for deliverability
 *  and for clients that refuse HTML). */
export type EmailMessage = {
  /** Recipient address. Validated by the caller before it reaches send(). */
  to: string;
  subject: string;
  /** Email-safe HTML (inline styles only: no external CSS, fonts or images). */
  html: string;
  /** Plain-text alternative of the same content. */
  text: string;
  /** Optional Reply-To address. */
  replyTo?: string;
  /** Optional extra email headers, for example List-Unsubscribe. */
  headers?: Record<string, string>;
  /** Optional key, unique per message, 1 to 256 characters. Resend sends a
   *  message whose key it has seen in the last 24 hours only once, so a retry
   *  of an `error` result cannot send the same email twice. Never logged. */
  idempotencyKey?: string;
};

/** Terminal disposition of a single message in a send. `invalid` addresses are
 *  pruned/suppressed by the caller (hard bounce / malformed); `error` is
 *  retryable (rate limit, transient 5xx).
 *  Derived from the shared DeliveryStatus owner (lib/deliveryStatus.ts). */
export type EmailDeliveryStatus = DeliveryStatus;

type PerMessageResult = {
  to: string;
  status: EmailDeliveryStatus;
  /** Provider message id when sent, for logging and idempotency. Never a secret. */
  id?: string;
  /** Short cause for skipped/invalid/error. Never a secret or an address. */
  reason?: string;
};

export interface EmailProvider {
  /** Deliver each message. Resolves one result per input message, in input
   *  order. Never throws: a per-message failure is a result, and a missing
   *  configuration answers every message `skipped`. */
  send(messages: readonly EmailMessage[]): Promise<PerMessageResult[]>;
}

/** The env keys the real Resend sender needs. Both must be present to go live.
 *  An API key with no verified From address cannot deliver. The boolean lives
 *  in lib/emailProviderConfigured.mjs so the digest script calls the same
 *  check without importing this TypeScript module. */
export function isResendConfigured(): boolean {
  return isEmailProviderConfigured();
}

/**
 * Active until email-provider credentials exist. Logs the count once and reports
 * every message as `skipped` — a truthful "nothing was delivered" the batch can
 * summarise without special-casing. Never sends, never throws.
 */
export const noopEmailProvider: EmailProvider = {
  async send(messages) {
    const [first] = messages;
    if (first) {
      console.info(
        `[emailProvider:noop] would deliver "${first.subject}" to ${messages.length} recipient(s) — email provider not configured, skipping.`,
      );
    }
    return messages.map((msg) => ({
      to: msg.to,
      status: "skipped" as const,
      reason: "email_provider_not_configured",
    }));
  },
};

// ── Resend transport ─────────────────────────────────────────────────────────

/** Resolved Resend credentials for one send. */
export type ResendConfig = {
  apiKey: string;
  /** The verified sender, for example `PUBMAXX <hello@pubmaxxing.com>`. */
  from: string;
};

type EmailFetch = (input: string, init: RequestInit) => Promise<Response>;

/** Injectable seams. Every one defaults to production behaviour. */
export type ResendProviderDeps = {
  /** HTTP transport. Defaults to the global fetch, read at send time. */
  fetch?: EmailFetch;
  /** Per-request deadline in milliseconds. */
  timeoutMs?: number;
  /** Credential resolver. Defaults to the RESEND_API_KEY and EMAIL_FROM env. */
  config?: () => ResendConfig | null;
};

/** Null unless both keys are set (the shared boolean) and non-blank. */
function resolveResendConfig(): ResendConfig | null {
  if (!isResendConfigured()) return null;
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? "";
  const from = process.env.EMAIL_FROM?.trim() ?? "";
  return apiKey && from ? { apiKey, from } : null;
}

function resendRequestHeaders(apiKey: string, msg: EmailMessage): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "User-Agent": RESEND_USER_AGENT,
    ...(msg.idempotencyKey ? { "Idempotency-Key": msg.idempotencyKey } : {}),
  };
}

function resendRequestBody(from: string, msg: EmailMessage): string {
  return JSON.stringify({
    from,
    to: [msg.to],
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
    ...(msg.headers && Object.keys(msg.headers).length > 0 ? { headers: msg.headers } : {}),
  });
}

/** The parsed answer body, or null. Never throws: a body that cannot be read
 *  must not turn an accepted send into a failure. */
async function readJson(response: Response): Promise<unknown> {
  try {
    return JSON.parse(await response.text());
  } catch {
    return null;
  }
}

function stringField(payload: unknown, field: string): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>)[field];
  return typeof value === "string" ? value : null;
}

// Resend error names are snake_case codes (`validation_error`). Anything else
// is not ours to echo into a reason.
const RESEND_ERROR_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const RESEND_MESSAGE_ID = /^[A-Za-z0-9-]{1,128}$/;

function resendErrorName(payload: unknown): string | null {
  const name = stringField(payload, "name");
  return name && RESEND_ERROR_NAME.test(name) ? name : null;
}

/** Resend answers a malformed or undeliverable recipient with 422 (older
 *  answers used 400) `validation_error` and a message naming the `to` field.
 *  The message is read here and nowhere else: it is never logged or returned. */
function isInvalidRecipientAnswer(httpStatus: number, payload: unknown): boolean {
  if (httpStatus !== 400 && httpStatus !== 422) return false;
  if (resendErrorName(payload) !== "validation_error") return false;
  return /`to`/.test(stringField(payload, "message") ?? "");
}

function classifyResendAnswer(to: string, httpStatus: number, payload: unknown): PerMessageResult {
  if (httpStatus >= 200 && httpStatus < 300) {
    const id = stringField(payload, "id");
    return id && RESEND_MESSAGE_ID.test(id) ? { to, status: "sent", id } : { to, status: "sent" };
  }
  if (isInvalidRecipientAnswer(httpStatus, payload)) {
    return { to, status: "invalid", reason: "resend_invalid_recipient" };
  }
  const name = resendErrorName(payload);
  return {
    to,
    status: "error",
    reason: name ? `resend_http_${httpStatus}_${name}` : `resend_http_${httpStatus}`,
  };
}

/** Error text safe to log: the key value cut out, and bounded. */
function safeErrorText(err: unknown, apiKey: string): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return raw.split(apiKey).join("[redacted]").slice(0, 200);
}

function logFailure(result: PerMessageResult, extra: Record<string, unknown>): void {
  log("warn", "email_provider.send_failed", {
    provider: "resend",
    recipient: maskEmail(result.to) ?? "[unparseable]",
    status: result.status,
    reason: result.reason,
    ...extra,
  });
}

async function sendOneResend(params: {
  msg: EmailMessage;
  config: ResendConfig;
  fetch: EmailFetch;
  timeoutMs: number;
}): Promise<PerMessageResult> {
  const { msg, config } = params;
  if (!isValidEmail(msg.to)) {
    const result: PerMessageResult = { to: msg.to, status: "invalid", reason: "invalid_recipient" };
    logFailure(result, {});
    return result;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("Resend request timed out.", "TimeoutError"));
  }, params.timeoutMs);
  try {
    const response = await params.fetch(RESEND_SEND_URL, {
      method: "POST",
      headers: resendRequestHeaders(config.apiKey, msg),
      body: resendRequestBody(config.from, msg),
      signal: controller.signal,
    });
    const result = classifyResendAnswer(msg.to, response.status, await readJson(response));
    if (result.status !== "sent") logFailure(result, { httpStatus: response.status });
    return result;
  } catch (err) {
    const result: PerMessageResult = {
      to: msg.to,
      status: "error",
      reason: controller.signal.aborted ? "resend_timeout" : "resend_request_failed",
    };
    logFailure(result, { error: safeErrorText(err, config.apiKey) });
    return result;
  } finally {
    clearTimeout(timer);
  }
}

function logBatch(results: readonly PerMessageResult[]): void {
  const count = (status: EmailDeliveryStatus) =>
    results.filter((result) => result.status === status).length;
  log("info", "email_provider.batch", {
    provider: "resend",
    messages: results.length,
    sent: count("sent"),
    invalid: count("invalid"),
    failed: count("error"),
  });
}

/**
 * Resend HTTP sender. Without both keys it answers exactly as the no-op does
 * (every message `skipped`, one log line, nothing sent), so a direct call can
 * never send or throw on a keyless deployment.
 */
export function createResendEmailProvider(deps: ResendProviderDeps = {}): EmailProvider {
  const resolveConfig = deps.config ?? resolveResendConfig;
  const timeoutMs = deps.timeoutMs ?? RESEND_REQUEST_TIMEOUT_MS;
  const fetchRequest: EmailFetch = deps.fetch ?? ((input, init) => globalThis.fetch(input, init));
  return {
    async send(messages) {
      const config = resolveConfig();
      if (!config) return noopEmailProvider.send(messages);
      if (messages.length === 0) return [];
      const results: PerMessageResult[] = [];
      // Sequential on purpose: Resend limits requests per team.
      for (const msg of messages) {
        results.push(await sendOneResend({ msg, config, fetch: fetchRequest, timeoutMs }));
      }
      logBatch(results);
      return results;
    },
  };
}

export const resendEmailProvider: EmailProvider = createResendEmailProvider();

/** Single selection point (mirrors lib/storeBackend.ts selectStore and
 *  lib/pushProvider.ts selectPushProvider): the real Resend sender when its env
 *  keys exist, the no-op otherwise. */
export function selectEmailProvider(): EmailProvider {
  return isResendConfigured() ? resendEmailProvider : noopEmailProvider;
}
