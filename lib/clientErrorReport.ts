// The one shape a client error may take, and the one place its text is
// redacted. GAP 16 of the mobile store-readiness audit: the whole app runs
// inside a WebView on somebody else's phone, and a JavaScript exception there
// produced nothing anybody would ever see. Vercel logs the server; the
// PostHog `$exception` lane is consent-gated and consent is default off. In
// week one the only signal would have been store reviews.
//
// This is deliberately the SMALL answer. No SDK, no processor, no new answer
// on either privacy form: a report carries an error CLASS, a redacted
// message, a closed route name and which shell it came from, and it is
// written as one structured server log line rather than stored. Anything
// larger is a decision above this file.
//
// FOUR RULES.
//
// 1. REDACTION HAPPENS TWICE. The browser redacts before sending and the route
//    redacts again on arrival, because a route may never trust what a caller
//    posts and a direct POST is not the browser.
// 2. THE ROUTE NAME IS THE CLOSED PAGEVIEW VOCABULARY. Not the URL: that is
//    what keeps a query string, a handle, a plan id and a message id out of
//    every report by construction, rather than by a regex hoping to catch them.
// 3. EVERY FIELD IS BOUNDED. A stack is never sent at all - it carries file
//    paths, and a minified one answers nothing a class and a message do not.
// 4. IT IS NOT ANALYTICS. It carries no person, no device id and no consent
//    identity, so it does not go through lib/analyticsEvents.ts and may never
//    grow a field that would make it a second analytics lane.

import { analyticsPageviewSurfaceFromPath } from "@/lib/analyticsPath";

/** What produced the report. Uncaught throw, or a promise nobody caught. */
export type ClientErrorKind = "error" | "unhandledrejection";

/** Which shell the browser was: the Capacitor app, or an ordinary browser. */
type ClientErrorShell = "native" | "web";

export type ClientErrorReport = {
  kind: ClientErrorKind;
  /** The error's constructor name, e.g. "TypeError". Bounded and redacted. */
  name: string;
  /** The error message, redacted and bounded. */
  message: string;
  /** A closed route template, never a URL. Null when the path is not one of ours. */
  route: string | null;
  shell: ClientErrorShell;
};

export const CLIENT_ERROR_NAME_MAX = 80;
export const CLIENT_ERROR_MESSAGE_MAX = 300;
/** A report is a few hundred bytes; anything larger is not one of ours. */
export const CLIENT_ERROR_MAX_BODY_BYTES = 2_000;

const KINDS: readonly ClientErrorKind[] = ["error", "unhandledrejection"];
const SHELLS: readonly ClientErrorShell[] = ["native", "web"];

// Each pattern replaces a whole class of value with a NAME for it, so the log
// line still reads as a sentence. Order matters: an email is reduced before
// the URL rule can swallow it, and a URL before the looser token and handle
// rules can chew through what is left of it.
const REDACTIONS: readonly [RegExp, string][] = [
  // Emails first: an address inside a URL must not survive as a path segment.
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "<email>"],
  // Any absolute URL loses its query, its fragment and its path.
  [/\b(?:https?|file|blob|capacitor|ionic):\/\/[^\s"')]+/gi, "<url>"],
  // A bare query string or fragment left behind by a relative path.
  [/[?#][^\s"')]*/g, ""],
  // Bearer tokens, JWTs and anything else long enough to be a secret.
  [/\b(?:bearer|token|key|secret|password|authorization)\b\s*[:=]?\s*\S+/gi, "<redacted>"],
  [/\beyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]+/g, "<token>"],
  // A UUID, which names a plan, a conversation or an account.
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>"],
  [/\b[0-9a-f]{32,}\b/gi, "<hex>"],
  [/\b[A-Za-z0-9_-]{40,}\b/g, "<token>"],
  // A PUBMAXX handle, which is a person.
  [/@[A-Za-z0-9_-]{2,}/g, "<handle>"],
];

/** Control characters, which would break the one-line log this ends up in. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

/**
 * Strip every class of value a message may not carry out of a browser: query
 * strings, URLs, tokens, emails and handles. Pure, and the ONE definition of
 * what redacted means here - the browser and the route both call this.
 */
export function redactClientErrorText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  let text = value;
  for (const [pattern, replacement] of REDACTIONS) text = text.replace(pattern, replacement);
  return text.replace(CONTROL_CHARACTERS, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Build the report from whatever a browser handed over, or answer null when
 * there is nothing worth reporting. Used by the browser AND by the route, so
 * a hand-rolled POST cannot describe itself differently from the reporter.
 */
export function buildClientErrorReport(input: {
  kind: unknown;
  name?: unknown;
  message?: unknown;
  path?: unknown;
  shell?: unknown;
}): ClientErrorReport | null {
  const kind = KINDS.find((value) => value === input.kind);
  if (!kind) return null;

  const name = redactClientErrorText(input.name, CLIENT_ERROR_NAME_MAX) || "Error";
  const message = redactClientErrorText(input.message, CLIENT_ERROR_MESSAGE_MAX);
  // A report with no message says nothing a log line could act on.
  if (!message) return null;

  return {
    kind,
    name,
    message,
    route: analyticsPageviewSurfaceFromPath(input.path),
    shell: SHELLS.find((value) => value === input.shell) ?? "web",
  };
}

/** The error class and message an uncaught value carries, whatever it is. */
export function describeThrownValue(value: unknown): { name: string; message: string } {
  if (value instanceof Error) {
    return { name: value.name || "Error", message: value.message || String(value) };
  }
  if (typeof value === "string") return { name: "Error", message: value };
  if (value && typeof value === "object" && "message" in value) {
    return {
      name: String((value as { name?: unknown }).name ?? "Error"),
      message: String((value as { message?: unknown }).message ?? ""),
    };
  }
  return { name: "Error", message: value === undefined ? "" : String(value) };
}
