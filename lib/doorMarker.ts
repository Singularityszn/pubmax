/**
 * A sign-in door this device took, so the page it returns to may finish the
 * tap the person already made.
 *
 * The marker lives in localStorage, not sessionStorage, because a magic link
 * opens in a FRESH TAB from the email client: a per-tab marker is absent by the
 * time the person lands back. It is keyed by its target, so a door taken for
 * one target can never act for somebody else's crafted return link, and it is
 * one-shot plus TTL-bounded, so a leftover marker cannot act tomorrow.
 */
export type DoorMarkerStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function markDoorTaken(storage: DoorMarkerStorage | null, key: string | null, now: number): void {
  if (!storage || !key) return;
  try {
    storage.setItem(key, JSON.stringify({ at: now }));
  } catch {
    // Storage blocked: the person can still tap again on the way back.
  }
}

function clearDoorTaken(storage: DoorMarkerStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // The TTL bounds an unreadable marker anyway.
  }
}

/**
 * Peek at a live marker without consuming it. An effect may run before
 * identity resolves, so the caller consumes it only when the action starts.
 */
export function peekDoorTaken(
  storage: DoorMarkerStorage | null,
  key: string | null,
  now: number,
  ttlMs: number,
): boolean {
  if (!storage || !key) return false;
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return false;
  }
  if (!raw) return false;
  let at: unknown;
  try {
    at = (JSON.parse(raw) as { at?: unknown } | null)?.at;
  } catch {
    at = null;
  }
  if (typeof at !== "number" || now - at >= ttlMs) {
    clearDoorTaken(storage, key);
    return false;
  }
  return true;
}

/** Consume a live marker. One-shot, so a crafted return link cannot reuse it. */
export function consumeDoorTaken(
  storage: DoorMarkerStorage | null,
  key: string | null,
  now: number,
  ttlMs: number,
): boolean {
  const live = peekDoorTaken(storage, key, now, ttlMs);
  if (live && storage && key) clearDoorTaken(storage, key);
  return live;
}
