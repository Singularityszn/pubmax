// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import RoundRota from "@/components/wild/RoundRota";
import { ROUND_ROTA_SESSION_KEY } from "@/components/wild/RoundRotaState";

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

  it("rejects a damaged saved order", async () => {
    window.sessionStorage.setItem(ROUND_ROTA_SESSION_KEY, JSON.stringify({
      version: 1, ownerId: "owner-a", rounds: [{ roundId: "round-a", names: ["Sam"], current: 10 }],
    }));
    await show();
    expect(host.querySelector(".roundRotaCurrent")).toBeNull();
    expect(host.textContent).not.toContain("Sam");
  });
});
