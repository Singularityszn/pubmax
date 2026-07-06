// Tiny structured logger (PRD §7.7). Emits ONE line of JSON per event so logs
// are grep-able and machine-parseable in Vercel/whatever aggregator sits
// downstream — no multi-line stack dumps, no key=value soup to reparse.
//
// The contract is deliberately small: callers pass a level, a stable `event`
// name (e.g. "pint_drops.storage_error"), and an optional context object of
// ALREADY-SAFE fields. This module does NOT try to deeply scrub arbitrary
// objects — it enforces the one rule that actually matters at the boundary
// (never serialise a raw photo buffer or an obviously secret-shaped key) and
// otherwise trusts the caller to hand over sanitized values (route name,
// status, an error *message* — never the raw error, IP, or key material).
//
// Server-only. No deps. Errors route to console.error; everything else to
// console.log so error events survive log-level filtering that drops stdout.

export type LogLevel = "info" | "warn" | "error";

// Field names that must never be logged in the clear. Matched case-insensitively
// against context keys; a hit is replaced with "[redacted]" rather than dropped
// so the *shape* of the log line stays stable and the redaction is visible.
const REDACT_KEY_PATTERN =
  /(pass(word|phrase)?|secret|token|api[-_]?key|service[-_]?role|authorization|cookie|\bkey\b|credential|\bip\b)/i;

// A single log record. `ts` is injectable so tests are deterministic; it
// defaults to Date.now() at call time.
export type LogRecord = {
  level: LogLevel;
  event: string;
  ts: number;
} & Record<string, unknown>;

/**
 * Redact obviously-sensitive fields and refuse to serialise large binary
 * payloads. This is a guardrail, NOT a substitute for callers passing safe
 * fields — see the module header. Returns a shallow copy; the input is never
 * mutated.
 *
 * Rules:
 *  - a key matching REDACT_KEY_PATTERN → "[redacted]"
 *  - a Buffer / ArrayBuffer / typed array (a raw photo, key bytes, …) →
 *    "[binary <n> bytes]" (length only, never the contents)
 */
export function redact(context: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (REDACT_KEY_PATTERN.test(key)) {
      out[key] = "[redacted]";
      continue;
    }
    const binaryLength = binaryByteLength(value);
    if (binaryLength !== null) {
      out[key] = `[binary ${binaryLength} bytes]`;
      continue;
    }
    out[key] = value;
  }
  return out;
}

// Returns the byte length when `value` is a binary payload we must not log
// (Buffer, ArrayBuffer, or any TypedArray/DataView), else null.
function binaryByteLength(value: unknown): number | null {
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return value.length;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  return null;
}

/**
 * Emit one structured log line.
 *
 * @param level   info | warn | error (error → console.error, else console.log)
 * @param event   stable dotted event name, e.g. "pint_drops.storage_error"
 * @param context optional map of ALREADY-SAFE fields (route, status, error
 *                message, …). Redacted defensively; never pass secrets/PII/raw
 *                buffers even though redact() will catch the common shapes.
 * @param ts      timestamp override for deterministic tests (default Date.now())
 */
export function log(
  level: LogLevel,
  event: string,
  context?: Record<string, unknown>,
  ts: number = Date.now(),
): void {
  const record: LogRecord = {
    level,
    event,
    ...(context ? redact(context) : {}),
    // ts last so a stray context `ts` can't clobber the real timestamp.
    ts,
  };
  const line = JSON.stringify(record);
  if (level === "error") console.error(line);
  else console.log(line);
}
