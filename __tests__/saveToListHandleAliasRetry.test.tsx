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
const VENUE_ID = "venue-1";
const HELD_LIST = "Date Night";
const LIST = "Want to Visit";
const HELD_RECORD = {
  venueId: VENUE_ID,
  listType: HELD_LIST,
  note: "Window seat",
  savedAt: "2026-10-06T10:00:00.000Z",
};

const serverRow = (listType: string) => ({
  venueId: VENUE_ID,
  venueName: "The Lamb",
  venueMapUrl: `/map?sel=${VENUE_ID}`,
  listType,
  savedAt: "2026-10-06T10:00:00.000Z",
});
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

let serverHolds: string[] = [];
let posts: Array<{ venueId?: string; listType?: string }> = [];
let aliasRequests: string[] = [];
let heldAliasReads: Array<() => void> = [];
let cleanup: (() => Promise<void>) | null = null;

beforeEach(() => {
  serverHolds = [HELD_LIST];
  posts = [];
  aliasRequests = [];
  heldAliasReads = [];
  window.localStorage.clear();
  window.localStorage.setItem("pubmax_handle", "mia");
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify([HELD_RECORD]));
  authedFetch.mockReset();
  authedActionFetch.mockReset();
  authedFetch.mockImplementation(async (input: string, init?: { method?: string; body?: string }) => {
    if (input.includes("lists=1")) return json({ lists: [] });
    if (init?.method === "POST") {
      const body = JSON.parse(init.body ?? "{}") as { venueId?: string; listType?: string };
      posts.push(body);
      const listType = body.listType ?? "";
      serverHolds = serverHolds.includes(listType)
        ? serverHolds.filter((name) => name !== listType)
        : [...serverHolds, listType];
    }
    return json({ saved: serverHolds.map(serverRow) });
  });
  authedActionFetch.mockImplementation(async () => json({ lists: [] }));
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => {
      aliasRequests.push(input);
      if (aliasRequests.length <= 3) return Promise.reject(new TypeError("Failed to fetch"));
      return new Promise((resolve) => {
        heldAliasReads.push(() => resolve({ ok: true, status: 200, json: async () => ({}) }));
      });
    }),
  );
});

afterEach(async () => {
  await cleanup?.();
  cleanup = null;
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

async function openWithHandle() {
  vi.resetModules();
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: SaveToListControl } = await import("@/components/savedpubs/SaveToListControl");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const settle = () =>
    act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  cleanup = async () => {
    await act(async () => {
      for (const release of heldAliasReads) release();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => root.unmount());
    container.remove();
  };
  await act(async () => {
    root.render(createElement(SaveToListControl, { venueId: VENUE_ID, venueName: "The Lamb" }));
  });
  await act(async () => {
    container.querySelector<HTMLButtonElement>("button.saveToListToggle")!.click();
  });
  await settle();
  await settle();
  const chip = (name: string): HTMLButtonElement => {
    const match = [...container.querySelectorAll<HTMLButtonElement>("button.saveToListChip")].find(
      (candidate) => candidate.textContent?.trim() === name,
    );
    if (!match) throw new Error(`no chip "${name}"`);
    return match;
  };
  const toast = () => container.querySelector(".saveToListToast")?.textContent;
  const input = () => container.querySelector<HTMLInputElement>("input[aria-label='New list name']")!;
  const press = async (name: string) => {
    await act(async () => {
      chip(name).click();
    });
    await settle();
    await settle();
  };
  const createWith = async (value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button.saveToListCreate")!.click();
    });
    await settle();
    await settle();
  };
  expect(chip(HELD_LIST).getAttribute("aria-pressed")).toBe("true");
  expect(chip(LIST).getAttribute("aria-pressed")).toBe("false");
  expect(chip(LIST).disabled).toBe(false);
  expect(window.localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify([HELD_RECORD]));
  expect(aliasRequests).toHaveLength(0);
  return { chip, toast, input, press, createWith };
}

describe("SaveToListControl with a handle while the alias lookup is retried", () => {
  it("confirms a chip save the server accepted", async () => {
    const ui = await openWithHandle();

    await ui.press(LIST);

    expect(aliasRequests.length).toBeGreaterThanOrEqual(3);
    expect(posts).toEqual([expect.objectContaining({ venueId: VENUE_ID, listType: LIST })]);
    expect(serverHolds).toEqual([HELD_LIST, LIST]);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")).toEqual([
      HELD_RECORD,
      { venueId: VENUE_ID, listType: LIST, savedAt: expect.any(String) },
    ]);
    expect(ui.toast()).toBe(`Saved to "${LIST}"`);
    expect(ui.chip(LIST).getAttribute("aria-pressed")).toBe("true");
    expect(ui.chip(HELD_LIST).getAttribute("aria-pressed")).toBe("true");
    expect(ui.chip(LIST).disabled).toBe(false);
    expect(ui.chip(HELD_LIST).disabled).toBe(false);
  });

  it("confirms a chip removal the server accepted", async () => {
    const ui = await openWithHandle();

    await ui.press(HELD_LIST);

    expect(aliasRequests.length).toBeGreaterThanOrEqual(3);
    expect(posts).toEqual([expect.objectContaining({ venueId: VENUE_ID, listType: HELD_LIST })]);
    expect(serverHolds).toEqual([]);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("[]");
    expect(ui.toast()).toBe(`Removed from "${HELD_LIST}"`);
    expect(ui.chip(HELD_LIST).getAttribute("aria-pressed")).toBe("false");
    expect(ui.chip(HELD_LIST).disabled).toBe(false);
    expect(ui.chip(LIST).disabled).toBe(false);
  });

  it("confirms a Create & save the server accepted", async () => {
    const ui = await openWithHandle();

    await ui.createWith(LIST);

    expect(authedActionFetch).toHaveBeenCalledTimes(1);
    expect(aliasRequests.length).toBeGreaterThanOrEqual(3);
    expect(posts).toEqual([expect.objectContaining({ venueId: VENUE_ID, listType: LIST })]);
    expect(serverHolds).toEqual([HELD_LIST, LIST]);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")).toEqual([
      HELD_RECORD,
      { venueId: VENUE_ID, listType: LIST, savedAt: expect.any(String) },
    ]);
    expect(ui.toast()).toBe(`Saved to "${LIST}"`);
    expect(ui.chip(LIST).getAttribute("aria-pressed")).toBe("true");
    expect(ui.chip(LIST).disabled).toBe(false);
    expect(ui.chip(HELD_LIST).disabled).toBe(false);
    expect(ui.input().value).toBe("");
  });
});
