import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTH_CLIENT_WAIT_CEILING_MS, authClientTurn } from "@/lib/authClientTurn";
import { PINS_VISIBLE_EVENT } from "@/lib/performanceMarks";

function fakeWindow(pathname: string) {
  const target = new EventTarget();
  return Object.assign(target, {
    location: { pathname },
    setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms) as unknown as number,
    clearTimeout: (id: number | undefined) => clearTimeout(id),
  });
}

function settled(promise: Promise<void>): Promise<boolean> {
  let done = false;
  void promise.then(() => {
    done = true;
  });
  return Promise.resolve()
    .then(() => Promise.resolve())
    .then(() => done);
}

const NO_CALLBACK = Promise.resolve(false);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("when the browser auth client may load", () => {
  it("loads at once for a stored session on the map, so a signed-in reader restores as before", async () => {
    const turn = authClientTurn(fakeWindow("/map"), {
      storedSession: true,
      nativeShell: false,
      pinsVisible: false,
      callback: NO_CALLBACK,
    });

    expect(await settled(turn.ready)).toBe(true);
  });

  it.each(["/", "/tonight", "/u/karan", "/mapping"])("loads at once on %s, where no pins are coming", async (pathname) => {
    const turn = authClientTurn(fakeWindow(pathname), {
      storedSession: false,
      nativeShell: false,
      pinsVisible: false,
      callback: NO_CALLBACK,
    });

    expect(await settled(turn.ready)).toBe(true);
  });

  it("loads at once in the native shell, whose sign-in returns wait on the session bootstrap", async () => {
    const turn = authClientTurn(fakeWindow("/map"), {
      storedSession: false,
      nativeShell: true,
      pinsVisible: false,
      callback: NO_CALLBACK,
    });

    expect(await settled(turn.ready)).toBe(true);
  });

  it("loads at once when the pins are already up", async () => {
    const turn = authClientTurn(fakeWindow("/map"), {
      storedSession: false,
      nativeShell: false,
      pinsVisible: true,
      callback: NO_CALLBACK,
    });

    expect(await settled(turn.ready)).toBe(true);
  });

  it.each(["/map", "/map/manchester"])("holds a signed-out reader on %s until the pins are visible", async (pathname) => {
    const win = fakeWindow(pathname);
    const turn = authClientTurn(win, { storedSession: false, nativeShell: false, pinsVisible: false, callback: NO_CALLBACK });

    expect(await settled(turn.ready)).toBe(false);
    win.dispatchEvent(new Event(PINS_VISIBLE_EVENT));
    expect(await settled(turn.ready)).toBe(true);
  });

  it.each(["pointerdown", "keydown"])("lets the reader's first %s end the wait", async (type) => {
    const win = fakeWindow("/map");
    const turn = authClientTurn(win, { storedSession: false, nativeShell: false, pinsVisible: false, callback: NO_CALLBACK });

    win.dispatchEvent(new Event(type));
    expect(await settled(turn.ready)).toBe(true);
  });

  it("finishes an auth callback without waiting for the pins", async () => {
    const turn = authClientTurn(fakeWindow("/map"), {
      storedSession: false,
      nativeShell: false,
      pinsVisible: false,
      callback: Promise.resolve(true),
    });

    expect(await settled(turn.ready)).toBe(true);
  });

  it("stops waiting at the ceiling when the map never draws", async () => {
    const turn = authClientTurn(fakeWindow("/map"), {
      storedSession: false,
      nativeShell: false,
      pinsVisible: false,
      callback: NO_CALLBACK,
    });

    vi.advanceTimersByTime(AUTH_CLIENT_WAIT_CEILING_MS - 1);
    expect(await settled(turn.ready)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(await settled(turn.ready)).toBe(true);
  });

  it("never loads after the provider has gone", async () => {
    const win = fakeWindow("/map");
    const turn = authClientTurn(win, { storedSession: false, nativeShell: false, pinsVisible: false, callback: NO_CALLBACK });

    turn.cancel();
    win.dispatchEvent(new Event(PINS_VISIBLE_EVENT));
    vi.advanceTimersByTime(AUTH_CLIENT_WAIT_CEILING_MS);
    expect(await settled(turn.ready)).toBe(false);
  });
});
