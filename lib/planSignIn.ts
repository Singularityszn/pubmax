type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type GuestPlan = { local: Record<string, string>; session: Record<string, string> };

export const PLAN_SIGN_IN_KEY = "pubmax:plan-sign-in:v1";
export const PUB_IMPORT_REVIEW_KEY = "pubmax:pub-import-review:v1";
const LOCAL_KEYS = ["pubmaxx:plan-route-draft:v1", "pubmax:plan-route-draft:v2", "pubmax:plan-intake:v1"];
const SESSION_KEYS = ["pubmaxx:plan-draft:v1", "pubmax:plan-draft:v2", PUB_IMPORT_REVIEW_KEY];
const MAX_AGE = 30 * 60_000;

export function openPlanSignIn(href: string): void {
  window.location.assign(href);
}

function copy(storage: DraftStorage | null, keys: string[]): Record<string, string> {
  return Object.fromEntries(keys.flatMap((key) => {
    const value = storage?.getItem(key);
    return value == null ? [] : [[key, value]];
  }));
}

/** Marks this tab's guest Plan to survive the first sign-in. The draft itself stays where it is. */
export function keepGuestPlanForSignIn(local: DraftStorage | null, session: DraftStorage | null): boolean {
  try {
    if (!session || local?.getItem("pubmax_account_owner")) return false;
    session.setItem(PLAN_SIGN_IN_KEY, JSON.stringify({ at: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads the guest Plan as it stands at sign-in, not as it stood at the tap.
 * A mounted composer may have saved it since, and it must get its own bytes back.
 */
export function takeGuestPlanForSignIn(local: DraftStorage | null, session: DraftStorage | null): GuestPlan | null {
  try {
    const raw = session?.getItem(PLAN_SIGN_IN_KEY) ?? null;
    session?.removeItem(PLAN_SIGN_IN_KEY);
    const at = raw ? JSON.parse(raw).at : NaN;
    if (!Number.isFinite(at) || at > Date.now() || Date.now() - at > MAX_AGE) return null;
    return { local: copy(local, LOCAL_KEYS), session: copy(session, SESSION_KEYS) };
  } catch { return null; }
}

export function restoreGuestPlanAfterSignIn(held: GuestPlan | null, local: DraftStorage | null, session: DraftStorage | null): void {
  try {
    if (!held) return;
    for (const [storage, values] of [[local, held.local], [session, held.session]] as const) {
      for (const [key, value] of Object.entries(values)) storage?.setItem(key, value);
    }
  } catch {}
}
