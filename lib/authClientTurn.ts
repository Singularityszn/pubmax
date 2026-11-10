import { PINS_VISIBLE_EVENT } from "@/lib/performanceMarks";

// supabase-js is about 57 KB on the wire and 220 KB to parse. A signed-out
// reader opening the map has no session for it to restore, and until the pins
// paint the network belongs to the pins (perf/AGENTS.md). So on a map page the
// browser auth client of a signed-out reader loads after the pins.
//
// It loads at once when a session is stored, when the durable resume cookie
// says one can be restored, when an auth callback has to be finished, and
// while a sign-in the reader started is in progress. A sign-in action loads
// the client itself (ensureSupabaseBrowser), and the wait ends when any caller
// has built it. A touch on the map does not load it.

const MAP_PATH = /^\/map(?:\/|$)/;

export type AuthClientTurnWindow = Pick<Window, "addEventListener" | "removeEventListener"> & {
  location: Pick<Location, "pathname">;
};

export type AuthClientTurn = {
  /** Resolves when the auth client may load. */
  ready: Promise<void>;
  /** True when the client waits for the pins: no stored session and no sign-in under way. */
  waiting: boolean;
  /** Drops the listener. `ready` then never resolves. */
  cancel: () => void;
};

export function authClientTurn(
  win: AuthClientTurnWindow,
  input: {
    storedSession: boolean;
    pendingSignIn: boolean;
    pinsVisible: boolean;
    /** Resolves true when an auth callback in the address has to be finished. */
    callback: Promise<boolean>;
    /** Asked only when the client would wait: true when a durable session may exist. */
    durableSession: () => Promise<boolean>;
    /** Asked only when the client would wait: resolves when another caller builds it. */
    clientBuilt: () => Promise<unknown>;
  },
): AuthClientTurn {
  if (
    input.storedSession ||
    input.pendingSignIn ||
    input.pinsVisible ||
    !MAP_PATH.test(win.location.pathname)
  ) {
    return { ready: Promise.resolve(), waiting: false, cancel: () => {} };
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
  function cancel() {
    open = false;
    win.removeEventListener(PINS_VISIBLE_EVENT, go);
  }
  win.addEventListener(PINS_VISIBLE_EVENT, go);
  const goWhen = (answer: Promise<boolean>) =>
    void answer.then(
      (yes) => {
        if (yes) go();
      },
      () => go(),
    );
  goWhen(input.callback);
  goWhen(input.durableSession());
  goWhen(input.clientBuilt().then(() => true));
  return { ready, waiting: true, cancel };
}
