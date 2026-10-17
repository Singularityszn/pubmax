// @vitest-environment jsdom

import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type Link from "next/link";
import TonightReturnCue from "@/app/tonight/TonightReturnCue";
import type { SavedPub } from "@/lib/savedPubs";
import {
  TONIGHT_RETURN_CUE_SOURCE_LINE,
  tonightReturnCue,
} from "@/lib/tonightReturnCue";
import { venueMapUrl } from "@/lib/venueMapUrl";

vi.mock("next/link", () => ({
  default: ({ prefetch, href, ...props }: ComponentProps<typeof Link>) =>
    createElement("a", { ...props, href: String(href), "data-prefetch": String(prefetch) }),
}));

const STORAGE_KEY = "pubmax:savedPubs:v1";

function save(venueId: string, listType: string, savedAt: string, note?: string): SavedPub {
  return { venueId, listType, savedAt, note };
}

// A plain object, the shape vitest.setup.ts installs when Node's own accessor
// shadows jsdom's Storage. It has no Storage.prototype behind it.
function plainStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    key: (index: number) => [...items.keys()][index] ?? null,
    getItem: (key: string) => items.get(String(key)) ?? null,
    setItem: (key: string, value: string) => void items.set(String(key), String(value)),
    removeItem: (key: string) => void items.delete(String(key)),
    clear: () => items.clear(),
  };
}

// Swap window.localStorage for one test, whether the runtime holds it as an
// accessor (jsdom, Node's own) or a value (the setup fallback), and hand back
// the undo. The original descriptor is saved before anything replaces it; when
// the property was inherited rather than own, the undo deletes the shadow.
function replaceLocalStorage(next: PropertyDescriptor): () => void {
  const original = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", { ...next, configurable: true });
  return () => {
    if (original) Object.defineProperty(window, "localStorage", original);
    else delete (window as { localStorage?: Storage }).localStorage;
  };
}

// The object a call to storage.setItem actually reaches: the storage itself
// when it owns the method (a plain object), its prototype when it inherits it
// (jsdom's Storage, where defining an own "setItem" would be a named-property
// write into the store instead).
function setItemOwner(storage: Storage): Storage {
  return Object.prototype.hasOwnProperty.call(storage, "setItem")
    ? storage
    : (Object.getPrototypeOf(storage) as Storage);
}

describe("tonightReturnCue", () => {
  const openable = new Set(["venue-a", "venue-b"]);

  it("stays quiet when the map's openable ids are unknown", () => {
    const saved = [save("venue-a", "Want to Visit", "2026-10-01T20:00:00.000Z")];
    expect(tonightReturnCue(saved, null)).toBeNull();
    expect(tonightReturnCue(saved, undefined)).toBeNull();
  });

  it("stays quiet with no saves, or none the map can open", () => {
    expect(tonightReturnCue([], openable)).toBeNull();
    expect(
      tonightReturnCue([save("venue-gone", "Want to Visit", "2026-10-01T20:00:00.000Z")], openable),
    ).toBeNull();
    expect(tonightReturnCue([save("", "Want to Visit", "2026-10-01T20:00:00.000Z")], openable)).toBeNull();
  });

  it("links the newest openable save across every list", () => {
    const cue = tonightReturnCue(
      [
        save("venue-a", "Want to Visit", "2026-10-01T20:00:00.000Z"),
        save("venue-b", "Cheap Pint", "2026-10-03T20:00:00.000Z"),
        save("venue-a", "Date night", "2026-10-02T20:00:00.000Z"),
        save("venue-gone", "Want to Visit", "2026-10-09T20:00:00.000Z"),
      ],
      openable,
    );
    expect(cue).toEqual({ href: venueMapUrl("venue-b") });
  });
});

describe("<TonightReturnCue />", () => {
  let container: HTMLDivElement;
  let root: Root;
  let restoreStorage: (() => void) | null = null;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    // Put the real storage back before anything below reads it: a blocked
    // getter left in place throws here and in every later beforeEach.
    restoreStorage?.();
    restoreStorage = null;
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function mount(ids: ReadonlySet<string> | null) {
    await act(async () => {
      root.render(createElement(TonightReturnCue, { selectableVenueIds: ids }));
    });
    // The read lands one microtask after the effect.
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("paints nothing on the server, whatever is saved", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([save("venue-a", "Want to Visit", "2026-10-01T20:00:00.000Z")]),
    );
    expect(
      renderToString(createElement(TonightReturnCue, { selectableVenueIds: new Set(["venue-a"]) })),
    ).toBe("");
  });

  it("shows one link to the map and where the saves came from, and nothing private", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        save("venue-a", "Secret birthday list", "2026-10-01T20:00:00.000Z", "Meet Sam by the window"),
      ]),
    );
    await mount(new Set(["venue-a"]));

    const cue = container.querySelector('[data-testid="tonight-return-cue"]');
    expect(cue).not.toBeNull();
    const links = cue!.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute("href")).toBe(venueMapUrl("venue-a"));
    expect(links[0]!.getAttribute("data-prefetch")).toBe("false");
    expect(links[0]!.textContent).toBe("Open your saved pub on the map");
    expect(cue!.textContent).toContain(TONIGHT_RETURN_CUE_SOURCE_LINE);

    const text = cue!.textContent ?? "";
    expect(text).not.toContain("venue-a");
    expect(text).not.toContain("Secret birthday list");
    expect(text).not.toContain("Meet Sam");
    expect(text).not.toMatch(/£|\d/);
  });

  it.each([
    ["absent", null],
    ["corrupt", "{not json"],
    ["not a list", JSON.stringify({ venueId: "venue-a" })],
    ["empty", "[]"],
  ])("stays quiet when storage is %s", async (_label, raw) => {
    if (raw !== null) window.localStorage.setItem(STORAGE_KEY, raw);
    await mount(new Set(["venue-a"]));
    expect(container.innerHTML).toBe("");
  });

  const valid = save("venue-a", "Want to Visit", "2026-10-01T20:00:00.000Z");
  const corruptSaves: Array<[string, unknown[]]> = [
    ["a save with no date", [{ venueId: "venue-a", listType: "Want to Visit" }]],
    ["a save dated with a number", [{ venueId: "venue-a", listType: "Want to Visit", savedAt: 1759348800000 }]],
    ["a save dated with an empty string", [{ venueId: "venue-a", listType: "Want to Visit", savedAt: "" }]],
    ["a save dated not-a-date", [{ venueId: "venue-a", listType: "Want to Visit", savedAt: "not-a-date" }]],
    ["a valid save beside one with no date", [valid, { venueId: "venue-b", listType: "Cheap Pint" }]],
    ["a valid save beside one dated with a number", [valid, { venueId: "venue-b", listType: "Cheap Pint", savedAt: 0 }]],
    [
      "a valid save beside one dated not-a-date",
      [valid, { venueId: "venue-b", listType: "Cheap Pint", savedAt: "not-a-date" }],
    ],
    ["a valid save beside a null record", [valid, null]],
    ["a valid save beside a bare string", [valid, "venue-b"]],
    ["a valid save beside a record with no list", [valid, { venueId: "venue-b", savedAt: "2026-10-02T20:00:00.000Z" }]],
    [
      "a valid save beside a record with a numeric list",
      [valid, { venueId: "venue-b", listType: 3, savedAt: "2026-10-02T20:00:00.000Z" }],
    ],
    [
      "a valid save beside a record with an empty list",
      [valid, { venueId: "venue-b", listType: "", savedAt: "2026-10-02T20:00:00.000Z" }],
    ],
    [
      "a valid save beside a record with an overlong list",
      [valid, { venueId: "venue-b", listType: "x".repeat(61), savedAt: "2026-10-02T20:00:00.000Z" }],
    ],
    [
      "a valid save beside a record with a numeric id",
      [valid, { venueId: 7, listType: "Cheap Pint", savedAt: "2026-10-02T20:00:00.000Z" }],
    ],
  ];

  it.each(corruptSaves)("stays quiet, and writes nothing back, when storage holds %s", async (_label, records) => {
    const raw = JSON.stringify(records);
    window.localStorage.setItem(STORAGE_KEY, raw);
    const owner = setItemOwner(window.localStorage);
    const setItem = vi.spyOn(owner, "setItem");
    const removeItem = vi.spyOn(owner, "removeItem");

    await mount(new Set(["venue-a", "venue-b"]));

    expect(container.innerHTML).toBe("");
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(raw);
  });

  it("links the newest of several saved pubs with the one fixed line, whatever order they are stored in", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        save("venue-a", "Want to Visit", "2026-10-01T20:00:00.000Z"),
        save("venue-b", "Cheap Pint", "2026-10-03T20:00:00.000Z"),
        save("venue-a", "Date night", "2026-10-02T20:00:00.000Z"),
      ]),
    );
    await mount(new Set(["venue-a", "venue-b"]));

    const links = container.querySelectorAll('[data-testid="tonight-return-cue"] a');
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute("href")).toBe(venueMapUrl("venue-b"));
    expect(links[0]!.textContent).toBe("Open your saved pub on the map");
  });

  it("stays quiet when the browser blocks site data", async () => {
    const real = window.localStorage;
    real.setItem(
      STORAGE_KEY,
      JSON.stringify([save("venue-a", "Want to Visit", "2026-10-01T20:00:00.000Z")]),
    );
    let blockedReads = 0;
    const restore = replaceLocalStorage({
      get() {
        blockedReads += 1;
        throw new DOMException("site data is blocked", "SecurityError");
      },
    });
    restoreStorage = restore;

    await mount(new Set(["venue-a"]));
    expect(blockedReads).toBeGreaterThan(0);
    expect(container.innerHTML).toBe("");

    // The undo hands back the very storage the test began with, still holding
    // the save the blocked getter hid.
    restore();
    restoreStorage = null;
    expect(window.localStorage).toBe(real);
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain("venue-a");
  });

  it.each([
    ["a value, as the Node fallback holds it", (storage: Storage) => ({ value: storage, writable: true })],
    ["an accessor, as jsdom and Node hold it", (storage: Storage) => ({ get: () => storage })],
  ])("reads saves from storage held as %s", async (_label, descriptor) => {
    const storage = plainStorage();
    const raw = JSON.stringify([save("venue-b", "Want to Visit", "2026-10-02T20:00:00.000Z")]);
    storage.setItem(STORAGE_KEY, raw);
    const setItem = vi.spyOn(storage, "setItem");
    restoreStorage = replaceLocalStorage(descriptor(storage));

    await mount(new Set(["venue-b"]));

    const link = container.querySelector('[data-testid="tonight-return-cue"] a');
    expect(link?.getAttribute("href")).toBe(venueMapUrl("venue-b"));
    expect(setItem).not.toHaveBeenCalled();
    expect(storage.getItem(STORAGE_KEY)).toBe(raw);
  });

  it("stays quiet when the map cannot say which pubs it opens", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([save("venue-a", "Want to Visit", "2026-10-01T20:00:00.000Z")]),
    );
    await mount(null);
    expect(container.innerHTML).toBe("");
  });

  it("reads saves without writing, fetching or tracking", async () => {
    const raw = JSON.stringify([save("venue-a", "Want to Visit", "2026-10-01T20:00:00.000Z")]);
    window.localStorage.setItem(STORAGE_KEY, raw);
    const setItem = vi.spyOn(setItemOwner(window.localStorage), "setItem");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await mount(new Set(["venue-a"]));

    expect(container.querySelector('[data-testid="tonight-return-cue"]')).not.toBeNull();
    expect(setItem).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(raw);
  });
});
