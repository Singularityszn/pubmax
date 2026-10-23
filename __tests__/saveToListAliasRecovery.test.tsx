// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authedFetch = vi.hoisted(() => vi.fn());
const authedActionFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authedFetch", () => ({ authedFetch, authedActionFetch }));
vi.mock("@/components/auth/authContext", () => ({
  useAuth: () => ({ user: null, loading: false, identityResolved: true, handle: null }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const STORAGE_KEY = "pubmax:savedPubs:v1";
const OLD_ID = "venue-1sw9ofl";
const CURRENT_ID = "venue-eltcmh";
const LIST = "Want to Visit";
const ORIGINAL_RAW = JSON.stringify([
  { venueId: OLD_ID, listType: LIST, note: "Friday route", savedAt: "2026-10-04T12:00:00.000Z" },
]);

let aliasReadsFail = true;
let cleanup: (() => Promise<void>) | null = null;

beforeEach(() => {
  aliasReadsFail = true;
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      if (aliasReadsFail) throw new TypeError("Failed to fetch");
      return {
        ok: true,
        status: 200,
        json: async () =>
          input === "/data/venue_id_aliases.json" ? { aliases: { [OLD_ID]: CURRENT_ID } } : {},
      };
    }),
  );
});

afterEach(async () => {
  await cleanup?.();
  cleanup = null;
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

async function openAfterFailedAliasRead() {
  vi.resetModules();
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: SaveToListControl } = await import("@/components/savedpubs/SaveToListControl");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  cleanup = async () => {
    await act(async () => root.unmount());
    container.remove();
  };
  const settle = () =>
    act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  const openPicker = async () => {
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button.saveToListToggle")!.click();
    });
    await settle();
  };
  await act(async () => {
    root.render(createElement(SaveToListControl, { venueId: CURRENT_ID, venueName: "The Blackfriar" }));
  });
  await openPicker();
  const chip = (name: string): HTMLButtonElement => {
    const match = [...container.querySelectorAll<HTMLButtonElement>("button.saveToListChip")].find(
      (candidate) => candidate.textContent?.trim() === name,
    );
    if (!match) throw new Error(`no chip "${name}"`);
    return match;
  };
  const toast = () => container.querySelector(".saveToListToast")?.textContent;
  const press = async (name: string) => {
    await act(async () => {
      chip(name).click();
    });
    await settle();
  };
  const createWith = async (value: string) => {
    const input = container.querySelector<HTMLInputElement>("input[aria-label='New list name']")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button.saveToListCreate")!.click();
    });
    await settle();
  };
  const reopen = async () => {
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button.saveToListClose")!.click();
    });
    await openPicker();
  };
  return { chip, toast, press, createWith, reopen };
}

describe("SaveToListControl when the alias lookup fails and then recovers", () => {
  it("keeps the old save and its note when an unpressed chip asks to save", async () => {
    window.localStorage.setItem(STORAGE_KEY, ORIGINAL_RAW);
    const ui = await openAfterFailedAliasRead();
    expect(ui.chip(LIST).disabled).toBe(false);
    expect(ui.chip(LIST).getAttribute("aria-pressed")).toBe("false");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(ORIGINAL_RAW);

    aliasReadsFail = false;
    await ui.press(LIST);

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(ORIGINAL_RAW);
    expect(ui.chip(LIST).getAttribute("aria-pressed")).toBe("true");
    expect(ui.toast()).toBe(`Saved to "${LIST}" on this device`);
  });

  it("keeps the old save and its note when Create & save names the list it is in, twice", async () => {
    window.localStorage.setItem(STORAGE_KEY, ORIGINAL_RAW);
    const ui = await openAfterFailedAliasRead();
    expect(ui.chip(LIST).getAttribute("aria-pressed")).toBe("false");

    aliasReadsFail = false;
    await ui.createWith(LIST);

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(ORIGINAL_RAW);
    expect(ui.chip(LIST).getAttribute("aria-pressed")).toBe("true");
    expect(ui.toast()).toBe(`Saved to "${LIST}" on this device`);

    await ui.createWith(LIST);

    expect(ui.chip(LIST).getAttribute("aria-pressed")).toBe("true");
    expect(ui.toast()).toBe(`Saved to "${LIST}" on this device`);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(ORIGINAL_RAW);
  });

  it("removes the old save, then saves the pub again, once a read has recovered the lookup", async () => {
    window.localStorage.setItem(STORAGE_KEY, ORIGINAL_RAW);
    const ui = await openAfterFailedAliasRead();
    aliasReadsFail = false;
    await ui.reopen();
    expect(ui.chip(LIST).getAttribute("aria-pressed")).toBe("true");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(ORIGINAL_RAW);

    await ui.press(LIST);
    expect(ui.chip(LIST).getAttribute("aria-pressed")).toBe("false");
    expect(ui.toast()).toBe(`Removed from "${LIST}"`);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("[]");

    await ui.press(LIST);
    expect(ui.chip(LIST).getAttribute("aria-pressed")).toBe("true");
    expect(ui.toast()).toBe(`Saved to "${LIST}" on this device`);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")).toEqual([
      { venueId: CURRENT_ID, listType: LIST, savedAt: expect.any(String) },
    ]);
  });
});
