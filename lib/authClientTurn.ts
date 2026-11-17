// Stored sessions, durable resume hints, callbacks and deliberate sign-in
// load the SDK. Unrelated signed-out pages never need the SDK, including
// after map pins appear or while a person browses between public routes.
const AUTH_PATH = /^\/(?:login|signup|auth)(?:\/|$)/;

export type AuthClientTurnWindow = Pick<Window, "addEventListener" | "removeEventListener"> & {
  location: Pick<Location, "pathname">;
};

export type AuthClientTurn = {
  /** Resolves when the auth client may load. */
  ready: Promise<void>;
  /** True when this turn initially defers client loading. */
  waiting: boolean;
  updatePathname: (pathname: string) => void;
  releaseForSignIn: () => void;
  /** Cancels future releases when the provider unmounts. */
  cancel: () => void;
};

export function authClientTurn(
  win: AuthClientTurnWindow,
  input: {
    storedSession: boolean;
    pendingSignIn: boolean;
    pinsVisible: boolean;
    storedSessionNow?: () => boolean;
    /** Resolves true when an auth callback in the address has to be finished. */
    callback: Promise<boolean>;
    /** Asked only when the client would wait: true only for a confirmed durable-session hint. */
    durableSession: () => Promise<boolean>;
    /** Asked only when the client would wait: resolves when another caller builds it. */
    clientBuilt: () => Promise<unknown>;
  },
): AuthClientTurn {
  if (
    input.storedSession ||
    input.pendingSignIn ||
    AUTH_PATH.test(win.location.pathname)
  ) {
    return { ready: Promise.resolve(), waiting: false, updatePathname: () => {}, releaseForSignIn: () => {}, cancel: () => {} };
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
    win.removeEventListener("storage", onStorage);
  }
  const onStorage = () => {
    try { if (input.storedSessionNow?.()) go(); } catch { /* Unknown storage is not a session. */ }
  };
  win.addEventListener("storage", onStorage);
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
  return {
    ready,
    waiting: true,
    releaseForSignIn: go,
    updatePathname: (pathname) => {
      if (AUTH_PATH.test(pathname)) go();
    },
    cancel,
  };
}
