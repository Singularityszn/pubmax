import type { ProviderAuthState } from "@/lib/authProviderRevision";

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const PLAN_SIGN_IN_KEY = "pubmax:plan-sign-in:v1";
export const PUB_IMPORT_REVIEW_KEY = "pubmax:pub-import-review:v1";
const LOCAL_KEYS = ["pubmaxx:plan-route-draft:v1", "pubmax:plan-route-draft:v2", "pubmax:plan-intake:v1"];
const SESSION_KEYS = ["pubmaxx:plan-draft:v1", "pubmax:plan-draft:v2", PUB_IMPORT_REVIEW_KEY];
const MAX_AGE = 30 * 60_000;

export function hasPlanActionAccount(accountId: string | null | undefined, state: ProviderAuthState): boolean {
  return Boolean(accountId) || state === "authenticated";
}

export function openPlanSignIn(href: string): void {
  window.location.assign(href);
}

function copy(storage: DraftStorage | null, keys: string[]): Record<string, string> {
  return Object.fromEntries(keys.flatMap((key) => {
    const value = storage?.getItem(key);
    return value == null ? [] : [[key, value]];
  }));
}

export function keepGuestPlanForSignIn(local: DraftStorage | null, session: DraftStorage | null): boolean {
  try {
    if (!session || local?.getItem("pubmax_account_owner")) return false;
    session.setItem(PLAN_SIGN_IN_KEY, JSON.stringify({ at: Date.now(), local: copy(local, LOCAL_KEYS), session: copy(session, SESSION_KEYS) }));
    return true;
  } catch {
    return false;
  }
}

export function takeGuestPlanForSignIn(session: DraftStorage | null): string | null {
  try {
    const raw = session?.getItem(PLAN_SIGN_IN_KEY) ?? null;
    session?.removeItem(PLAN_SIGN_IN_KEY);
    return raw;
  } catch { return null; }
}

export function restoreGuestPlanAfterSignIn(raw: string | null, local: DraftStorage | null, session: DraftStorage | null): void {
  try {
    if (!raw) return;
    const held = JSON.parse(raw);
    if (!Number.isFinite(held.at) || held.at > Date.now() || Date.now() - held.at > MAX_AGE) return;
    for (const [storage, values, keys] of [[local, held.local, LOCAL_KEYS], [session, held.session, SESSION_KEYS]] as const) {
      for (const key of keys) if (typeof values?.[key] === "string") storage?.setItem(key, values[key]);
    }
  } catch {}
}
