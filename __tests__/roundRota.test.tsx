// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import RoundRota from "@/components/wild/RoundRota";
import { ROUND_ROTA_SESSION_KEY, clearRoundRota, readRoundRota, saveRoundRota } from "@/components/wild/RoundRotaState";

let host: HTMLDivElement;
let root: Root;
let activeOwner: string | null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.sessionStorage.clear();
  activeOwner = "owner-a";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function show(ownerId = "owner-a", roundId = "round-a") {
  activeOwner = ownerId;
  await act(async () => { root.render(<RoundRota ownerId={ownerId} roundId={roundId} currentOwnerId={() => activeOwner} />); });
}

async function add(name: string) {
  const input = host.querySelector<HTMLInputElement>("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, name);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
}

async function press(label: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find((node) => (node.getAttribute("aria-label") ?? node.textContent) === label)!;
  expect(button, label).not.toBeUndefined();
  await act(async () => { button.click(); });
}

describe("a private turn order", () => {
  it("retains the first and ninth orders when later Rounds are saved, updated and cleared", () => {
    const storage = window.sessionStorage;
    expect(saveRoundRota("owner-a", "round-1", { names: ["Sam", "Priya"], current: 1 }, storage)).toBe(true);
    for (let round = 2; round <= 10; round += 1) {
      expect(saveRoundRota("owner-a", `round-${round}`, { names: ["Lee"], current: 0 }, storage)).toBe(true);
    }
    expect(readRoundRota("owner-a", "round-1", storage)).toEqual({ names: ["Sam", "Priya"], current: 1 });
    expect(readRoundRota("owner-a", "round-9", storage)).toEqual({ names: ["Lee"], current: 0 });
    expect(readRoundRota("owner-b", "round-1", storage)).toEqual({ names: [], current: 0 });
    expect(saveRoundRota("owner-a", "round-9", { names: ["Jo", "Ali"], current: 1 }, storage)).toBe(true);
    expect(readRoundRota("owner-a", "round-9", storage)).toEqual({ names: ["Jo", "Ali"], current: 1 });
    expect(readRoundRota("owner-a", "round-1", storage)).toEqual({ names: ["Sam", "Priya"], current: 1 });
    expect(clearRoundRota("owner-a", "round-9", storage)).toBe(true);
    expect(readRoundRota("owner-a", "round-9", storage)).toEqual({ names: [], current: 0 });
    expect(readRoundRota("owner-a", "round-1", storage)).toEqual({ names: ["Sam", "Priya"], current: 1 });
    expect(readRoundRota("owner-a", "round-10", storage)).toEqual({ names: ["Lee"], current: 0 });
  });

  it.each([
    { names: ["Sam"], current: 1 },
    { names: ["Sam", "sam"], current: 0 },
    { names: ["A".repeat(41)], current: 0 },
    { names: Array.from({ length: 13 }, (_, index) => `Person ${index}`), current: 0 },
  ])("rejects a malformed ninth order without weakening entry validation: %j", (invalid) => {
    const rounds = Array.from({ length: 8 }, (_, index) => ({ roundId: `round-${index + 1}`, names: ["Sam"], current: 0 }));
    window.sessionStorage.setItem(ROUND_ROTA_SESSION_KEY, JSON.stringify({
      version: 1, ownerId: "owner-a", rounds: [...rounds, { roundId: "round-9", ...invalid }],
    }));
    expect(readRoundRota("owner-a", "round-9", window.sessionStorage)).toEqual({ names: [], current: 0 });
    expect(saveRoundRota("owner-a", "round-9", invalid, window.sessionStorage)).toBe(false);
  });

  it("uses the chosen names and advances one person per tap", async () => {
    await show();
    expect(host.textContent).toContain("Add the names in turn order.");
    await add("Sam");
    await add("Priya");
    expect(host.querySelector("[role='status']")?.textContent).toContain("Sam");
    await act(async () => { host.querySelector<HTMLButtonElement>("button[data-next-turn]")!.click(); });
    expect(host.querySelector("[role='status']")?.textContent).toContain("Priya");
    await act(async () => { host.querySelector<HTMLButtonElement>("button[data-next-turn]")!.click(); });
    expect(host.querySelector("[role='status']")?.textContent).toContain("Sam");
  });

  it("requires a valid, distinct name", async () => {
    await show();
    await add(" ");
    expect(host.querySelector("[role='alert']")?.textContent).toBe("Add a name.");
    await add("  Sam  ");
    await add("sam");
    expect(host.querySelector("[role='alert']")?.textContent).toContain("already in the order");
    expect(host.querySelectorAll(".roundRotaNames li")).toHaveLength(1);
    await add("Name\u0001with a control");
    expect(host.querySelector("[role='alert']")?.textContent).toContain("one line");
  });

  it("keeps the current person when an earlier name is removed and advances when that person is removed", async () => {
    await show();
    await add("Sam"); await add("Priya"); await add("Lee");
    await press("Next person");
    await press("Remove Sam");
    expect(host.querySelector(".roundRotaCurrent")?.textContent).toContain("Priya");
    await press("Remove Priya");
    expect(host.querySelector(".roundRotaCurrent")?.textContent).toContain("Lee");
    await press("Remove Lee");
    expect(host.querySelector(".roundRotaCurrent")).toBeNull();
    expect(host.textContent).toContain("Add the names in turn order.");
  });

  it("restores an ordinary return and keeps separate Rounds for the same owner", async () => {
    await show(); await add("Sam"); await add("Priya"); await press("Next person");
    await act(async () => { root.unmount(); });
    root = createRoot(host);
    await show();
    expect(host.querySelector(".roundRotaCurrent")?.textContent).toContain("Priya");
    await show("owner-a", "round-b");
    expect(host.querySelector(".roundRotaCurrent")).toBeNull();
    await add("Lee");
    await show();
    expect(host.querySelector(".roundRotaCurrent")?.textContent).toContain("Priya");
    expect(host.textContent).not.toContain("Lee");
  });

  it("resets the turn and explicitly clears the names", async () => {
    await show(); await add("Sam"); await add("Priya"); await press("Next person");
    await press("Start order again");
    expect(host.querySelector(".roundRotaCurrent")?.textContent).toContain("Sam");
    await press("Clear names");
    expect(host.querySelector(".roundRotaCurrent")).toBeNull();
    expect(window.sessionStorage.getItem(ROUND_ROTA_SESSION_KEY)).toBeNull();
  });

  it("never restores another owner's names", async () => {
    await show(); await add("Sam");
    await show("owner-b");
    expect(host.querySelector(".roundRotaCurrent")).toBeNull();
    expect(host.textContent).not.toContain("Sam");
  });

  it("refuses an action after the verified owner changes", async () => {
    await show(); await add("Sam"); await add("Priya");
    const saved = window.sessionStorage.getItem(ROUND_ROTA_SESSION_KEY);
    activeOwner = "owner-b";
    await press("Next person");
    expect(window.sessionStorage.getItem(ROUND_ROTA_SESSION_KEY)).toBe(saved);
    expect(host.querySelector(".roundRotaCurrent")?.textContent).toContain("Sam");
  });

  it("works in memory when the browser blocks storage and sends no requests", async () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => { throw new Error("Blocked"); });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await show(); await add("Sam"); await add("Priya"); await press("Next person");
    expect(host.querySelector(".roundRotaCurrent")?.textContent).toContain("Priya");
    expect(host.textContent).toContain("cannot keep this order after a reload");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports a quota failure and retains the previously saved order", async () => {
    await show(); await add("Sam"); await add("Priya"); await press("Next person");
    const saved = window.sessionStorage.getItem(ROUND_ROTA_SESSION_KEY);
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    await add("Lee");
    expect(host.textContent).toContain("Your browser cannot keep this order after a reload.");
    expect(host.querySelectorAll(".roundRotaNames li")).toHaveLength(3);
    expect(window.sessionStorage.getItem(ROUND_ROTA_SESSION_KEY)).toBe(saved);
    write.mockRestore();
    await act(async () => { root.unmount(); });
    root = createRoot(host);
    await show();
    expect(host.querySelector(".roundRotaCurrent")?.textContent).toContain("Priya");
    expect(host.querySelectorAll(".roundRotaNames li")).toHaveLength(2);
    expect(host.textContent).not.toContain("Lee");
  });

  it("rejects a damaged saved order", async () => {
    window.sessionStorage.setItem(ROUND_ROTA_SESSION_KEY, JSON.stringify({
      version: 1, ownerId: "owner-a", rounds: [{ roundId: "round-a", names: ["Sam"], current: 10 }],
    }));
    await show();
    expect(host.querySelector(".roundRotaCurrent")).toBeNull();
    expect(host.textContent).not.toContain("Sam");
  });
});
