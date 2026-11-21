// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import BeenHereFirstRun from "@/components/profile/BeenHereFirstRun";
import {
  BEEN_HERE_CARRY_ACTION,
  BEEN_HERE_CARRY_KEY,
  BEEN_HERE_COPY,
  BEEN_HERE_FIRST_RUN_PUBS,
  BEEN_HERE_FIRST_RUN_SEEN_KEY,
  BEEN_HERE_LIST,
  markBeenHereFirstRunSeen,
} from "@/lib/beenHere";
import { carryBeenHere } from "@/lib/beenHereCarry";

// The first-run card on the You tab: it shows once per device, a tap lands on
// this device's Been here list at once, the account gets the taps in ONE
// request, and nothing ever writes a diary entry (a tap has no date).

const authedFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authedFetch", () => ({ authedFetch, authedActionFetch: vi.fn() }));
const session = vi.hoisted(() => ({
  user: null as { id: string } | null,
  identityResolved: true,
}));
vi.mock("@/components/auth/authContext", () => ({
  useAuth: () => ({ ...session, loading: false, handle: null }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const SAVED_KEY = "pubmax:savedPubs:v1";
const [FIRST, SECOND] = BEEN_HERE_FIRST_RUN_PUBS;

let container: HTMLDivElement;
let root: Root;
const networkFetch = vi.fn(async () => new Response("{}", { status: 404 }));

beforeEach(() => {
  window.localStorage.clear();
  authedFetch.mockReset();
  networkFetch.mockReset();
  networkFetch.mockImplementation(async () => new Response("{}", { status: 404 }));
  vi.stubGlobal("fetch", networkFetch);
  session.user = null;
  session.identityResolved = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(handle?: string): Promise<void> {
  await act(async () => {
    root.render(createElement(BeenHereFirstRun, handle === undefined ? {} : { handle }));
  });
  // The decision runs in a microtask after the first paint.
  await act(async () => {
    await Promise.resolve();
  });
}

async function remount(handle?: string): Promise<void> {
  await act(async () => root.unmount());
  root = createRoot(container);
  await render(handle);
}

function card(): HTMLElement | null {
  return container.querySelector<HTMLElement>("section.beenHereFirstRun");
}

function chip(venueId: string): HTMLButtonElement {
  const match = container.querySelector<HTMLButtonElement>(`button[data-venue-id="${venueId}"]`);
  if (!match) throw new Error(`no chip for ${venueId}`);
  return match;
}

function button(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!match) throw new Error(`no button "${label}"`);
  return match;
}

async function tap(venueId: string): Promise<void> {
  await act(async () => {
    chip(venueId).click();
  });
  await vi.waitFor(() => {
    const stored = JSON.parse(window.localStorage.getItem(SAVED_KEY) ?? "[]") as unknown[];
    expect(stored).toBeDefined();
  });
  // Let the device write and the chip's own settle run.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function deviceBeenHere(): string[] {
  const stored = JSON.parse(window.localStorage.getItem(SAVED_KEY) ?? "[]") as Array<{
    venueId: string;
    listType: string;
  }>;
  return stored.filter((row) => row.listType === BEEN_HERE_LIST).map((row) => row.venueId);
}

function noDiaryWrite(): void {
  const urls = [...authedFetch.mock.calls, ...networkFetch.mock.calls].map((call) => String(call[0]));
  expect(urls.some((url) => url.includes("/api/diary"))).toBe(false);
}

describe("the Been here first-run card", () => {
  it("shows the pubs with their areas on a device that has never seen it", async () => {
    await render();
    expect(card()).not.toBeNull();
    expect(card()?.textContent).toContain(BEEN_HERE_COPY.title);
    expect(container.querySelectorAll("button[data-venue-id]")).toHaveLength(BEEN_HERE_FIRST_RUN_PUBS.length);
    expect(chip(FIRST!.venueId).getAttribute("aria-label")).toBe(`${FIRST!.name}, ${FIRST!.area}`);
    expect(chip(FIRST!.venueId).getAttribute("aria-pressed")).toBe("false");
    // Signed out, the line says where the taps are kept.
    expect(card()?.textContent).toContain(BEEN_HERE_COPY.deviceLine);
    expect(window.localStorage.getItem(BEEN_HERE_FIRST_RUN_SEEN_KEY)).toBeNull();
  });

  it("closes on Not now and stays closed on this device", async () => {
    await render();
    await act(async () => button(BEEN_HERE_COPY.notNow).click());
    expect(card()).toBeNull();
    await remount();
    expect(card()).toBeNull();
  });

  it("closes on Done and stays closed", async () => {
    await render();
    await act(async () => button(BEEN_HERE_COPY.done).click());
    expect(card()).toBeNull();
    await remount();
    expect(card()).toBeNull();
  });

  it("returns when it is left unanswered", async () => {
    await render();
    expect(card()).not.toBeNull();
    await remount();
    expect(card()).not.toBeNull();
  });

  it("waits for identity before it decides anything", async () => {
    session.identityResolved = false;
    await render();
    expect(card()).toBeNull();
    expect(window.localStorage.getItem(BEEN_HERE_FIRST_RUN_SEEN_KEY)).toBeNull();
  });

  it("never pushes a reader off the section a link sent them to, and shows on the next visit", async () => {
    // The price receipt links to /u/<handle>#contribution-impact, and the
    // page scrolls there before this card would open above it.
    window.history.replaceState(null, "", "#contribution-impact");
    try {
      await render();
      expect(card()).toBeNull();
      expect(window.localStorage.getItem(BEEN_HERE_FIRST_RUN_SEEN_KEY)).toBeNull();
    } finally {
      window.history.replaceState(null, "", window.location.pathname);
    }
    await remount();
    expect(card()).not.toBeNull();
  });

  it("puts a tap on this device's Been here list at once, and a second tap takes it off", async () => {
    await render();
    await tap(FIRST!.venueId);
    expect(chip(FIRST!.venueId).getAttribute("aria-pressed")).toBe("true");
    expect(deviceBeenHere()).toEqual([FIRST!.venueId]);
    // Signed out, the tap waits for an account, owned by nobody yet.
    expect(JSON.parse(window.localStorage.getItem(BEEN_HERE_CARRY_KEY) ?? "null")).toEqual({
      owner: null,
      venueIds: [FIRST!.venueId],
    });
    // Nothing went to an account, and nothing to the diary.
    expect(authedFetch).not.toHaveBeenCalled();
    noDiaryWrite();

    await tap(FIRST!.venueId);
    expect(chip(FIRST!.venueId).getAttribute("aria-pressed")).toBe("false");
    expect(deviceBeenHere()).toEqual([]);
    expect(window.localStorage.getItem(BEEN_HERE_CARRY_KEY)).toBeNull();
  });

  it("signed in, moves every tap to the account in ONE request when the card closes", async () => {
    session.user = { id: "user-mia" };
    authedFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { venueIds?: string[] };
      return new Response(JSON.stringify({ saved: [], carried: body.venueIds ?? [], refused: [] }), { status: 200 });
    });
    await render("mia");
    expect(card()?.textContent).toContain(BEEN_HERE_COPY.accountLine);
    // Nothing was waiting, so the page asked nothing on the way in.
    expect(authedFetch).not.toHaveBeenCalled();

    await tap(FIRST!.venueId);
    await tap(SECOND!.venueId);
    expect(authedFetch).not.toHaveBeenCalled();

    await act(async () => button(BEEN_HERE_COPY.done).click());
    await vi.waitFor(() => expect(authedFetch).toHaveBeenCalledTimes(1));
    const [url, init] = authedFetch.mock.calls[0]!;
    expect(url).toBe("/api/saved-pubs");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      handle: "mia",
      action: BEEN_HERE_CARRY_ACTION,
      venueIds: [FIRST!.venueId, SECOND!.venueId],
    });
    await vi.waitFor(() => expect(window.localStorage.getItem(BEEN_HERE_CARRY_KEY)).toBeNull());
    expect(deviceBeenHere().sort()).toEqual([FIRST!.venueId, SECOND!.venueId].sort());
    noDiaryWrite();
  });

  it.each(["", "#contribution-impact"])("after dismissal and sign-in, transfers pending taps with hash '%s'", async (hash) => {
    window.localStorage.setItem(BEEN_HERE_FIRST_RUN_SEEN_KEY, "1");
    window.localStorage.setItem(
      BEEN_HERE_CARRY_KEY,
      JSON.stringify({ owner: null, venueIds: [FIRST!.venueId] }),
    );
    session.user = { id: "user-mia" };
    authedFetch.mockResolvedValue(
      new Response(JSON.stringify({ saved: [], carried: [FIRST!.venueId], refused: [] }), { status: 200 }),
    );
    window.history.replaceState(null, "", `${window.location.pathname}${hash}`);
    try {
      await render("mia");
    } finally {
      window.history.replaceState(null, "", window.location.pathname);
    }
    // The card itself does not come back.
    expect(card()).toBeNull();
    await vi.waitFor(() => expect(authedFetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String((authedFetch.mock.calls[0]![1] as RequestInit).body))).toMatchObject({
      handle: "mia",
      venueIds: [FIRST!.venueId],
    });
    await vi.waitFor(() => expect(window.localStorage.getItem(BEEN_HERE_CARRY_KEY)).toBeNull());
  });

  it.each([
    ["signed-in return", BEEN_HERE_COPY.done],
    ["signed-in return", BEEN_HERE_COPY.notNow],
    ["sign-in while open", BEEN_HERE_COPY.done],
    ["sign-in while open", BEEN_HERE_COPY.notNow],
    ["sign-in return", BEEN_HERE_COPY.done],
    ["sign-in return", BEEN_HERE_COPY.notNow],
    ["hash return", BEEN_HERE_COPY.done],
    ["hash return", BEEN_HERE_COPY.notNow],
  ])("keeps unfinished choices editable on %s until %s", async (visit, dismissal) => {
    const signedIn = visit === "signed-in return" || visit === "hash return";
    if (signedIn) session.user = { id: "user-mia" };
    authedFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { venueIds?: string[] };
      return new Response(JSON.stringify({ carried: body.venueIds ?? [], refused: [] }), { status: 200 });
    });
    await render(signedIn ? "mia" : undefined);
    await tap(FIRST!.venueId);
    await tap(SECOND!.venueId);

    session.user = { id: "user-mia" };
    if (visit === "sign-in while open") {
      await render("mia");
    } else if (visit === "hash return") {
      window.history.replaceState(null, "", "#contribution-impact");
      try {
        await remount("mia");
        expect(card()).toBeNull();
        expect(authedFetch).not.toHaveBeenCalled();
        expect(window.localStorage.getItem(BEEN_HERE_FIRST_RUN_SEEN_KEY)).toBeNull();
      } finally {
        window.history.replaceState(null, "", window.location.pathname);
      }
      await remount("mia");
    } else {
      await remount("mia");
    }

    expect(authedFetch).not.toHaveBeenCalled();
    expect(chip(FIRST!.venueId).getAttribute("aria-pressed")).toBe("true");
    await tap(FIRST!.venueId);
    expect(deviceBeenHere()).toEqual([SECOND!.venueId]);
    expect(authedFetch).not.toHaveBeenCalled();

    await act(async () => button(dismissal).click());
    await vi.waitFor(() => expect(authedFetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String((authedFetch.mock.calls[0]![1] as RequestInit).body))).toEqual({
      handle: "mia",
      action: BEEN_HERE_CARRY_ACTION,
      venueIds: [SECOND!.venueId],
    });
    await vi.waitFor(() => expect(window.localStorage.getItem(BEEN_HERE_CARRY_KEY)).toBeNull());
    expect(card()).toBeNull();
  });

  it.each(["storage event", "selected pub", "unselected pub", BEEN_HERE_COPY.done, BEEN_HERE_COPY.notNow])(
    "rejects edits after another tab dismisses, through %s",
    async (action) => {
      session.user = { id: "user-mia" };
      authedFetch.mockResolvedValue(
        new Response(JSON.stringify({ carried: [FIRST!.venueId], refused: [] }), { status: 200 }),
      );
      await render("mia");
      await act(async () => chip(FIRST!.venueId).click());
      expect(deviceBeenHere()).toEqual([FIRST!.venueId]);

      markBeenHereFirstRunSeen();
      await act(async () => {
        expect(await carryBeenHere("mia", "user-mia")).toBe("carried");
      });
      expect(card()).not.toBeNull();

      await act(async () => {
        if (action === "storage event") {
          window.dispatchEvent(new StorageEvent("storage", {
            key: BEEN_HERE_FIRST_RUN_SEEN_KEY,
            newValue: "1",
            storageArea: window.localStorage,
          }));
        } else if (action === "selected pub" || action === "unselected pub") {
          chip(action === "selected pub" ? FIRST!.venueId : SECOND!.venueId).click();
        } else {
          button(action).click();
        }
      });

      expect(card()).toBeNull();
      expect(deviceBeenHere()).toEqual([FIRST!.venueId]);
      expect(window.localStorage.getItem(BEEN_HERE_CARRY_KEY)).toBeNull();
      expect(authedFetch).toHaveBeenCalledTimes(1);
    },
  );

  it("does not accept edits before aliases resolve, including after an unanswered remount", async () => {
    let release!: () => void;
    const aliases = new Promise<void>((resolve) => { release = resolve; });
    networkFetch.mockImplementation(async () => {
      await aliases;
      return new Response("{}", { status: 404 });
    });
    await render();
    expect(card()).toBeNull();
    expect(window.localStorage.getItem(BEEN_HERE_FIRST_RUN_SEEN_KEY)).toBeNull();
    await remount();
    expect(card()).toBeNull();
    await act(async () => { release(); });

    expect(card()).not.toBeNull();
    await act(async () => {
      chip(FIRST!.venueId).click();
      expect(deviceBeenHere()).toEqual([FIRST!.venueId]);
      expect(JSON.parse(window.localStorage.getItem(BEEN_HERE_CARRY_KEY) ?? "null")).toEqual({
        owner: null, venueIds: [FIRST!.venueId],
      });
    });
    await remount();
    expect(chip(FIRST!.venueId).getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      chip(FIRST!.venueId).click();
      expect(deviceBeenHere()).toEqual([]);
      expect(window.localStorage.getItem(BEEN_HERE_CARRY_KEY)).toBeNull();
    });
    await remount();
    expect(chip(FIRST!.venueId).getAttribute("aria-pressed")).toBe("false");
  });

  it("stays dismissed if another tab closes while aliases load", async () => {
    let release!: () => void;
    const aliases = new Promise<void>((resolve) => { release = resolve; });
    networkFetch.mockImplementation(async () => {
      await aliases;
      return new Response("{}", { status: 404 });
    });
    await render();
    expect(card()).toBeNull();
    markBeenHereFirstRunSeen();
    await act(async () => { release(); });
    expect(card()).toBeNull();
    expect(deviceBeenHere()).toEqual([]);
    expect(window.localStorage.getItem(BEEN_HERE_CARRY_KEY)).toBeNull();
  });

  it.each([
    [true, BEEN_HERE_COPY.done, true],
    [false, BEEN_HERE_COPY.done, true],
    [true, BEEN_HERE_COPY.notNow, true],
    [false, BEEN_HERE_COPY.notNow, true],
    [true, BEEN_HERE_COPY.done, false],
    [false, BEEN_HERE_COPY.done, false],
    [true, BEEN_HERE_COPY.notNow, false],
    [false, BEEN_HERE_COPY.notNow, false],
  ])("commits %s choice before %s and remount, signed in: %s", async (wanted, dismissal, signedIn) => {
    const initial = wanted ? [FIRST!.venueId] : [FIRST!.venueId, SECOND!.venueId];
    const expected = wanted ? [FIRST!.venueId, SECOND!.venueId] : [FIRST!.venueId];
    window.localStorage.setItem(SAVED_KEY, JSON.stringify(initial.map((venueId) => ({
      venueId, listType: BEEN_HERE_LIST, savedAt: "2026-11-01T00:00:00Z",
    }))));
    window.localStorage.setItem(BEEN_HERE_CARRY_KEY, JSON.stringify({
      owner: signedIn ? "user-mia" : null, venueIds: initial,
    }));
    let release!: () => void;
    const aliases = new Promise<void>((resolve) => { release = resolve; });
    networkFetch.mockImplementation(async () => {
      await aliases;
      return new Response("{}", { status: 404 });
    });
    session.user = signedIn ? { id: "user-mia" } : null;
    authedFetch.mockResolvedValue(new Response(JSON.stringify({
      carried: expected, refused: [],
    }), { status: 200 }));
    await render(signedIn ? "mia" : undefined);
    expect(card()).toBeNull();
    await act(async () => { release(); });
    await act(async () => {
      chip(SECOND!.venueId).click();
      expect(deviceBeenHere()).toEqual(expected);
      expect(JSON.parse(window.localStorage.getItem(BEEN_HERE_CARRY_KEY) ?? "null")).toEqual({
        owner: signedIn ? "user-mia" : null, venueIds: expected,
      });
      button(dismissal).click();
      expect(window.localStorage.getItem(BEEN_HERE_FIRST_RUN_SEEN_KEY)).toBe("1");
    });
    expect(card()).toBeNull();
    await remount(signedIn ? "mia" : undefined);
    expect(card()).toBeNull();

    expect(deviceBeenHere()).toEqual(expected);
    expect(window.localStorage.getItem(BEEN_HERE_FIRST_RUN_SEEN_KEY)).toBe("1");
    if (signedIn) {
      expect(authedFetch).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String((authedFetch.mock.calls[0]![1] as RequestInit).body))).toEqual({
        handle: "mia", action: BEEN_HERE_CARRY_ACTION, venueIds: expected,
      });
      expect(window.localStorage.getItem(BEEN_HERE_CARRY_KEY)).toBeNull();
    } else {
      expect(authedFetch).not.toHaveBeenCalled();
      expect(JSON.parse(window.localStorage.getItem(BEEN_HERE_CARRY_KEY) ?? "null")).toEqual({
        owner: null, venueIds: expected,
      });
    }
  });

  it("keeps the waiting taps when the account cannot take them yet", async () => {
    window.localStorage.setItem(BEEN_HERE_FIRST_RUN_SEEN_KEY, "1");
    const waiting = JSON.stringify({ owner: null, venueIds: [FIRST!.venueId] });
    window.localStorage.setItem(BEEN_HERE_CARRY_KEY, waiting);
    session.user = { id: "user-mia" };
    authedFetch.mockResolvedValue(new Response("{}", { status: 503 }));
    await render("mia");
    await vi.waitFor(() => expect(authedFetch).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(window.localStorage.getItem(BEEN_HERE_CARRY_KEY)).toBe(waiting);
  });

  it("never moves one account's taps to another account", async () => {
    window.localStorage.setItem(BEEN_HERE_FIRST_RUN_SEEN_KEY, "1");
    window.localStorage.setItem(
      BEEN_HERE_CARRY_KEY,
      JSON.stringify({ owner: "user-sam", venueIds: [FIRST!.venueId] }),
    );
    session.user = { id: "user-mia" };
    await render("mia");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(authedFetch).not.toHaveBeenCalled();
  });

  it("signed out, never asks the account for anything", async () => {
    window.localStorage.setItem(
      BEEN_HERE_CARRY_KEY,
      JSON.stringify({ owner: null, venueIds: [FIRST!.venueId] }),
    );
    await render();
    await act(async () => button(BEEN_HERE_COPY.done).click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(authedFetch).not.toHaveBeenCalled();
    noDiaryWrite();
  });
});
