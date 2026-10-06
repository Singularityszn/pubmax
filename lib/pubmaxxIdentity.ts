import { normalizeHandle } from "@/lib/profiles";
import { HANDLE_MAX } from "@/lib/handleNormalize";

export const HANDLE_RENAME_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1_000;

const HANDLE_MIN = 3;
const HANDLE_PATTERN = new RegExp(`^[a-z0-9_]{${HANDLE_MIN},${HANDLE_MAX}}$`);
export const RESERVED_CONTRIBUTOR_HANDLES = [
  "karan",
  "sarah",
  "carol",
  "erin",
  "nikhil",
  "tiffany",
  "karanmanoharan",
  "karanszn",
  "karansznx",
  "karanm",
  "karanmrn",
  "kai",
  "janaki",
  "manoharan",
] as const;
const RESERVED_CONTRIBUTOR_HANDLE_SET = new Set<string>(
  RESERVED_CONTRIBUTOR_HANDLES,
);
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
  // `/u/you` and `handle=you` are the viewer's own alias, never an account.
  "you",
]);
const RESERVED_BRAND_PATTERN = /^(?:pubmaxx|pubmaxxing|pubmaxxer)[_-]?(?:admin|help|official|safety|staff|support)$/;
const BLOCKED_TERMS = new Set(["fuck", "fucker", "nigger", "nigga"]);
const KARAN_STEMS = ["karan", "karans"] as const;
const KARAN_FAMILY_TERMS = [
  "dad",
  "father",
  "papa",
  "mom",
  "mum",
  "mother",
  "mama",
  "bro",
  "brother",
  "sis",
  "sister",
  "son",
  "daughter",
  "uncle",
  "aunt",
  "wife",
  "husband",
  "gf",
  "bf",
  "boyfriend",
  "girlfriend",
] as const;

export type HandleAssessment =
  | { ok: true; handle: string }
  | { ok: false; reason: "invalid" | "reserved"; error: string };

export function isReservedContributorHandle(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  return RESERVED_CONTRIBUTOR_HANDLE_SET.has(
    raw.trim().replace(/^@/, "").toLowerCase(),
  );
}

function normalizedIdentityText(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

function containsBlockedTerm(compact: string): boolean {
  for (const term of BLOCKED_TERMS) {
    if (compact.includes(term)) return true;
  }
  return false;
}

function isKaranStem(token: string): boolean {
  return (KARAN_STEMS as readonly string[]).includes(token);
}

function isKaranFamilyTerm(token: string): boolean {
  return (KARAN_FAMILY_TERMS as readonly string[]).includes(token);
}

/**
 * One word that joins Karan to a family term: karansdad (anywhere in the word,
 * because the possessive never starts a real surname), xkarandad (the word
 * ends at the term), dadkaran.
 */
function isKaranFamilyCompound(word: string): boolean {
  return KARAN_FAMILY_TERMS.some(
    (term) =>
      word.includes(`karans${term}`) ||
      word.endsWith(`karan${term}`) ||
      KARAN_STEMS.some((stem) => word.startsWith(`${term}${stem}`)),
  );
}

/**
 * Karan plus a family word, matched word by word so a real surname that only
 * starts with a family term (Dadlani, Momin, Sisodia) stays available. A stem
 * is also read joined to the word after it, so karan_sdad reads as karansdad.
 */
function violatesOwnerKaranPolicy(normalized: string): boolean {
  if (!normalized.includes("karan")) return false;
  const tokens = normalized.replace(/['’]/g, "").split(/[^a-z]+/).filter(Boolean);
  const joined = tokens.flatMap((token, at) =>
    isKaranStem(token) && at + 1 < tokens.length ? [`${token}${tokens[at + 1]}`] : [],
  );
  if ([...tokens, ...joined].some(isKaranFamilyCompound)) return true;
  return tokens.some(isKaranStem) && tokens.some(isKaranFamilyTerm);
}

/**
 * Public /u/[handle] must not offer claim shells for impersonation compounds
 * (karansdad, karan-father, …). Founder contributor handles such as `karan`
 * stay routable when a live profile exists.
 */
export function isPubmaxxHandleImpersonationBlock(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const handle = normalizeHandle(raw);
  if (!handle) return false;
  if (isReservedContributorHandle(handle)) return false;
  return violatesIdentityPolicy(handle);
}

function violatesIdentityPolicy(raw: string): boolean {
  const normalized = normalizedIdentityText(raw);
  return (
    containsBlockedTerm(normalized.replace(/[^a-z0-9]+/g, "")) ||
    violatesOwnerKaranPolicy(normalized)
  );
}

export type DisplayNameAssessment =
  | { ok: true; displayName: string }
  | { ok: false; reason: "reserved"; error: string };

export function assessPubmaxxDisplayName(raw: unknown): DisplayNameAssessment {
  if (typeof raw !== "string") {
    return { ok: false, reason: "reserved", error: "That name is not available." };
  }
  const displayName = raw.trim().replace(/\s+/g, " ");
  if (!displayName) {
    return { ok: false, reason: "reserved", error: "That name is not available." };
  }
  if (violatesIdentityPolicy(displayName)) {
    return { ok: false, reason: "reserved", error: "That name is not available." };
  }
  return { ok: true, displayName };
}

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
  if (isReservedContributorHandle(handle)) {
    return {
      ok: false,
      reason: "reserved",
      error: "That handle is not available.",
    };
  }
  if (
    RESERVED_EXACT.has(handle) ||
    RESERVED_BRAND_PATTERN.test(handle) ||
    violatesIdentityPolicy(handle)
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
