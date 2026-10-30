// The share target: a link or a pub name another app shares INTO PUBMAXX lands
// in the Wanted paste flow ("Pubs to try"), pre-filled and never fetched.
//
// One pure leaf for three doors. The web manifest's `share_target` sends a GET
// to SHARE_TARGET_PATH with `title`, `text` and `url`; the native shells hand
// the same query to `pubmaxx://share` (lib/nativeDeepLinks.ts); and the page
// at app/share reads it. All three build the paste here, so a shared TikTok or
// Instagram link reaches the existing resolver exactly as a pasted one does.
//
// THE SHARED URL IS TEXT. Nothing in this module, the page or the resolver
// fetches it, unfurls it or asks its platform about it (CONTEXT.md, Wanted). The
// resolver matches names and keeps the link only as where the idea came from.
//
// SIGNED OUT, THE TEXT STAYS ON THE DEVICE. A share can arrive before the
// person has signed in, and the sign-in round trip loses the query. So the
// page keeps the paste in this browser's localStorage under one key, and the
// signed-in return reads it back. It is never sent anywhere until the person
// presses Find, and it expires after a week.

import { cleanText } from "@/lib/textClean";

/**
 * The Wanted raw-paste cap, restated rather than imported: `lib/wanted.ts`
 * pulls the UK base pub graph, and this leaf rides the share page's first
 * paint. `__tests__/nativeShareTarget.test.ts` holds the two equal.
 */
export const SHARED_PASTE_MAX = 500;
const MAX_WANTED_RAW_PASTE = SHARED_PASTE_MAX;

export const SHARE_TARGET_PATH = "/share";

/** The `share_target.params` names in public/manifest.webmanifest. */
export const SHARE_TARGET_PARAMS = ["title", "text", "url"] as const;
export type ShareTargetParam = (typeof SHARE_TARGET_PARAMS)[number];

export const SHARED_PASTE_STORAGE_KEY = "pubmax_shared_wanted_paste_v1";
export const SHARED_PASTE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** The sign-in door hands the reader back to the share page. */
export const SHARE_TARGET_SIGN_IN_HREF = "/login?mode=signin&from=%2Fshare";

export type SharedInput = Partial<Record<ShareTargetParam, string | null | undefined>>;

function piece(value: unknown): string {
  return cleanText(value, MAX_WANTED_RAW_PASTE);
}

/**
 * Build the one paste the Wanted resolver reads from what another app shared.
 *
 * `text` leads, because it is what the person chose to send and often already
 * carries the link. `url` follows unless `text` already holds it. `title` is
 * used only when there is no text, because apps fill it with their own name
 * ("Instagram") far more often than with a pub's.
 */
export function sharedPasteFrom(input: SharedInput): string {
  const text = piece(input.text);
  const url = piece(input.url);
  const title = piece(input.title);
  const parts: string[] = [];
  if (text) parts.push(text);
  else if (title) parts.push(title);
  if (url && !parts.some((part) => part.includes(url))) parts.push(url);
  return cleanText(parts.join(" "), MAX_WANTED_RAW_PASTE);
}

/** Read the three params from a query, first value of each. */
export function sharedInputFromRecord(
  params: Record<string, string | string[] | undefined>,
): SharedInput {
  const input: SharedInput = {};
  for (const name of SHARE_TARGET_PARAMS) {
    const raw = params[name];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === "string") input[name] = value;
  }
  return input;
}

type StoredPaste = { paste: string; savedAt: number };

/** Keep a shared paste on this device. Storage may be absent or throw. */
export function stashSharedPaste(storage: Storage | null, paste: string, now = Date.now()): void {
  const clean = piece(paste);
  if (!storage || !clean) return;
  try {
    storage.setItem(SHARED_PASTE_STORAGE_KEY, JSON.stringify({ paste: clean, savedAt: now }));
  } catch {
    // Blocked storage: the page still pre-fills from its own query.
  }
}

/** The kept paste, or "" when there is none or it is older than a week. */
export function readSharedPaste(storage: Storage | null, now = Date.now()): string {
  if (!storage) return "";
  try {
    const raw = storage.getItem(SHARED_PASTE_STORAGE_KEY);
    if (!raw) return "";
    const value = JSON.parse(raw) as Partial<StoredPaste> | null;
    if (!value || typeof value.paste !== "string" || typeof value.savedAt !== "number") return "";
    if (now - value.savedAt > SHARED_PASTE_MAX_AGE_MS || value.savedAt > now + 60_000) {
      storage.removeItem(SHARED_PASTE_STORAGE_KEY);
      return "";
    }
    return piece(value.paste);
  } catch {
    return "";
  }
}

export function clearSharedPaste(storage: Storage | null): void {
  if (!storage) return;
  try {
    storage.removeItem(SHARED_PASTE_STORAGE_KEY);
  } catch {
    // Nothing to clear when storage is blocked.
  }
}
