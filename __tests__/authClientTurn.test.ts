import { describe, expect, it } from "vitest";

import { authClientTurn } from "@/lib/authClientTurn";
import { PINS_VISIBLE_EVENT } from "@/lib/performanceMarks";

function fakeWindow(pathname: string) {
  return Object.assign(new EventTarget(), { location: { pathname } });
}

function settled(promise: Promise<void>): Promise<boolean> {
  let done = false;
  void promise.then(() => {
    done = true;
  });
  return Promise.resolve()
    .then(() => Promise.resolve())
    .then(() => Promise.resolve())
    .then(() => done);
}

const SIGNED_OUT = {
  storedSession: false,
  pendingSignIn: false,
  pinsVisible: false,
  callback: Promise.resolve(false),
  durableSession: () => Promise.resolve(false),
  clientBuilt: () => new Promise<unknown>(() => {}),
};

describe("when the browser auth client may load", () => {
  it("loads at once for a stored session on the map, so a signed-in reader restores as before", async () => {
    const turn = authClientTurn(fakeWindow("/map"), { ...SIGNED_OUT, storedSession: true });

    expect(turn.waiting).toBe(false);
    expect(await settled(turn.ready)).toBe(true);
  });

  it("loads at once when the durable resume cookie says a session can be restored", async () => {
    const turn = authClientTurn(fakeWindow("/map"), {
      ...SIGNED_OUT,
      durableSession: () => Promise.resolve(true),
    });

    expect(await settled(turn.ready)).toBe(true);
  });

  it("loads at once while a sign-in the reader started is in progress", async () => {
    const turn = authClientTurn(fakeWindow("/map"), { ...SIGNED_OUT, pendingSignIn: true });

    expect(await settled(turn.ready)).toBe(true);
  });

  it("attaches once a sign-in action has built the client", async () => {
    let built!: () => void;
    const clientBuilt = () => new Promise<unknown>((resolve) => { built = () => resolve({}); });
    const turn = authClientTurn(fakeWindow("/map"), { ...SIGNED_OUT, clientBuilt });

    expect(turn.waiting).toBe(true);
    expect(await settled(turn.ready)).toBe(false);
    built();
    expect(await settled(turn.ready)).toBe(true);
  });

  it("finishes an auth callback without waiting for the pins", async () => {
    const turn = authClientTurn(fakeWindow("/map"), { ...SIGNED_OUT, callback: Promise.resolve(true) });

    expect(await settled(turn.ready)).toBe(true);
  });

  it.each(["/", "/tonight", "/u/karan", "/mapping"])("loads at once on %s, where no pins are coming", async (pathname) => {
    const turn = authClientTurn(fakeWindow(pathname), SIGNED_OUT);

    expect(await settled(turn.ready)).toBe(true);
  });

  it("loads at once when the pins are already up", async () => {
    const turn = authClientTurn(fakeWindow("/map"), { ...SIGNED_OUT, pinsVisible: true });

    expect(await settled(turn.ready)).toBe(true);
  });

  it.each(["/map", "/map/manchester"])("holds a signed-out reader on %s until the pins are visible", async (pathname) => {
    const win = fakeWindow(pathname);
    const turn = authClientTurn(win, SIGNED_OUT);

    expect(await settled(turn.ready)).toBe(false);
    win.dispatchEvent(new Event(PINS_VISIBLE_EVENT));
    expect(await settled(turn.ready)).toBe(true);
  });

  it.each(["pointerdown", "keydown", "touchstart"])("keeps waiting through a %s on the map", async (type) => {
    const win = fakeWindow("/map");
    const turn = authClientTurn(win, SIGNED_OUT);

    win.dispatchEvent(new Event(type));
    expect(await settled(turn.ready)).toBe(false);
  });

  it("asks the durable cookie only when the client would wait", async () => {
    let asked = 0;
    const durableSession = () => {
      asked += 1;
      return Promise.resolve(false);
    };
    authClientTurn(fakeWindow("/map"), { ...SIGNED_OUT, storedSession: true, durableSession });
    authClientTurn(fakeWindow("/tonight"), { ...SIGNED_OUT, durableSession });
    expect(asked).toBe(0);

    authClientTurn(fakeWindow("/map"), { ...SIGNED_OUT, durableSession });
    expect(asked).toBe(1);
  });

  it("never loads after the provider has gone", async () => {
    const win = fakeWindow("/map");
    const turn = authClientTurn(win, SIGNED_OUT);

    turn.cancel();
    win.dispatchEvent(new Event(PINS_VISIBLE_EVENT));
    expect(await settled(turn.ready)).toBe(false);
  });
});
