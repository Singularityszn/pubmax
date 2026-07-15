import { normalizeHandle } from "@/lib/profiles";

export const HANDLE_RENAME_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1_000;

const HANDLE_PATTERN = /^[a-z0-9_]{3,30}$/;
const RESERVED_EXACT = new Set([
  "admin",
  "api",
  "help",
  "moderation",
  "official",
  "pubmaxx",
  "pubmaxxer",
  "pubmaxxing",
  "root",
  "safety",
  "staff",
  "support",
  "system",
]);
const RESERVED_BRAND_PATTERN = /^(?:pubmaxx|pubmaxxing|pubmaxxer)[_-]?(?:admin|help|official|safety|staff|support)$/;
const BLOCKED_TERMS = new Set(["fuck", "fucker", "nigger", "nigga"]);

export type HandleAssessment =
  | { ok: true; handle: string }
  | { ok: false; reason: "invalid" | "reserved"; error: string };

/**
 * Validate a user-facing handle without silently accepting punctuation.
 * A leading @, surrounding whitespace, and letter casing are presentation
 * differences; every other character must already be in the canonical
 * [a-z0-9_] alphabet.
 */
export function assessPubmaxxHandle(raw: unknown): HandleAssessment {
  if (typeof raw !== "string") {
    return { ok: false, reason: "invalid", error: "Choose a handle between 3 and 30 characters." };
  }
  const presented = raw.trim().replace(/^@/, "").toLowerCase();
  const handle = normalizeHandle(raw);
  if (!HANDLE_PATTERN.test(presented) || handle !== presented) {
    return {
      ok: false,
      reason: "invalid",
      error: "Use 3–30 letters, numbers, or underscores.",
    };
  }
  const pieces = handle.split("_").filter(Boolean);
  if (
    RESERVED_EXACT.has(handle) ||
    RESERVED_BRAND_PATTERN.test(handle) ||
    pieces.some((piece) => BLOCKED_TERMS.has(piece))
  ) {
    return { ok: false, reason: "reserved", error: "That handle is reserved." };
  }
  return { ok: true, handle };
}

export type HandleRenameDecision =
  | { allowed: true }
  | { allowed: false; retryAt: string };

export function evaluateHandleRename(input: {
  changedAt?: string | null;
  now?: number;
}): HandleRenameDecision {
  if (!input.changedAt) return { allowed: true };
  const changedAt = Date.parse(input.changedAt);
  if (!Number.isFinite(changedAt)) return { allowed: true };
  const now = input.now ?? Date.now();
  const retryAt = changedAt + HANDLE_RENAME_COOLDOWN_MS;
  return now >= retryAt
    ? { allowed: true }
    : { allowed: false, retryAt: new Date(retryAt).toISOString() };
}

export type PublicHandleAlias = {
  handle: string;
  currentHandle: string;
  isCurrent: boolean;
};
