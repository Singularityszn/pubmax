import { PINS_VISIBLE_EVENT } from "@/lib/performanceMarks";

// supabase-js is about 57 KB on the wire and 220 KB to parse. A signed-out
// reader opening the map has no session for it to restore, and until the pins
// paint the network belongs to the pins (perf/AGENTS.md). So on a map page,
// with no stored session, the browser auth client waits for the pins.
//
// It never waits when a session is stored (a signed-in reader restores as
// before), when an auth callback has to be finished, in the native shell (whose
// sign-in returns wait on the session bootstrap), or on a page with no pins
// coming. The reader's first press or key ends the wait, and so does a ceiling,
// for a map that never draws.

/** The longest a signed-out map reader's auth client waits for the pins. */
export const AUTH_CLIENT_WAIT_CEILING_MS = 20_000;

const MAP_PATH = /^\/map(?:\/|$)/;
const INTERACTION_EVENTS = ["pointerdown", "keydown"] as const;

export type AuthClientTurnWindow = Pick<
  Window,
  "addEventListener" | "removeEventListener" | "setTimeout" | "clearTimeout"
> & { location: Pick<Location, "pathname"> };

export type AuthClientTurn = {
  /** Resolves when the auth client may load. */
  ready: Promise<void>;
  /** Drops the listeners and the ceiling. `ready` then never resolves. */
  cancel: () => void;
};

export function authClientTurn(
  win: AuthClientTurnWindow,
  input: {
    storedSession: boolean;
    nativeShell: boolean;
    pinsVisible: boolean;
    /** Resolves true when an auth callback in the address has to be finished. */
    callback: Promise<boolean>;
  },
): AuthClientTurn {
  if (
    input.storedSession ||
    input.nativeShell ||
    input.pinsVisible ||
    !MAP_PATH.test(win.location.pathname)
  ) {
    return { ready: Promise.resolve(), cancel: () => {} };
  }
  let release: () => void = () => {};
  let open = true;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  const go = () => {
    if (!open) return;
    cancel();
    release();
  };
  win.addEventListener(PINS_VISIBLE_EVENT, go);
  for (const type of INTERACTION_EVENTS) win.addEventListener(type, go, true);
  const ceiling = win.setTimeout(go, AUTH_CLIENT_WAIT_CEILING_MS);
  function cancel() {
    open = false;
    win.removeEventListener(PINS_VISIBLE_EVENT, go);
    for (const type of INTERACTION_EVENTS) win.removeEventListener(type, go, true);
    win.clearTimeout(ceiling);
  }
  void input.callback.then(
    (pending) => {
      if (pending) go();
    },
    () => go(),
  );
  return { ready, cancel };
}
