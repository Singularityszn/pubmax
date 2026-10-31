// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PlanTableBeacon from "@/components/plan/PlanTableBeacon";

const props = { planId: "11111111-1111-4111-8111-111111111111", memberToken: "member-a", ownerKey: "account-a:session-one", refreshKey: "route1:arrival1" };
function answer(canEdit = false) {
  return {
    visibility: "member", canEdit, routeRevision: 1, arrivalId: "arrival1",
    current: { venueId: "venue-first", venueName: "The First Pub", position: 0 },
    next: { venueId: "venue-next", venueName: "The Next Pub", position: 1 },
    beacon: { symbol: "star", note: "Upstairs, by the window", expiresAt: new Date(Date.now() + 60_000).toISOString() },
  };
}
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function render(next = props) { await act(async () => { root.render(createElement(PlanTableBeacon, next)); }); }
async function click(text: string) {
  const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === text);
  if (!button) throw new Error(`Missing button: ${text}`);
  await act(async () => button.click());
}

describe("Find our table at its rendered boundary", () => {
  it("shows a member the pub, next pub, labelled symbol and full-screen sign", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(answer())));
    await render();
    expect(container.textContent).toContain("Upstairs, by the window");
    expect(container.querySelector('a[href="/map?sel=venue-first"]')?.textContent).toBe("Meet us at The First Pub");
    expect(container.querySelector('a[href="/map?sel=venue-next"]')?.textContent).toBe("Meet us next at The Next Pub");
    expect(container.querySelector("form")).toBeNull();
    await click("Show table sign full screen");
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Star at The First Pub");
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(dialog);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("gives only the server-confirmed host the edit controls", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(answer(true))));
    await render();
    expect(container.querySelector("form")).not.toBeNull();
    expect(container.querySelector("textarea")?.getAttribute("maxlength")).toBe("160");
    expect([...container.querySelectorAll("option")].map((item) => item.textContent)).toEqual(["Star", "Moon", "Diamond", "Circle"]);
  });

  it("discards the old sign immediately on account change and ignores a late parsed response", async () => {
    let finish: (body: unknown) => void = () => {};
    const pending = new Promise((resolve) => { finish = resolve; });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json(answer()))
      .mockResolvedValueOnce({ ok: true, json: () => pending })
      .mockResolvedValueOnce(Response.json({ ...answer(), beacon: null }));
    vi.stubGlobal("fetch", fetcher);
    await render();
    expect(container.textContent).toContain("Upstairs, by the window");
    await render({ ...props, ownerKey: "account-b:session-two" });
    expect(container.textContent).not.toContain("Upstairs, by the window");
    await render({ ...props, ownerKey: "account-c:session-three" });
    await act(async () => finish(answer()));
    expect(container.textContent).not.toContain("Upstairs, by the window");
    expect(container.textContent).toContain("No table sign is set here.");
  });

  it("hides an expired sign even when no replacement read arrives", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(answer())).mockImplementation(() => new Promise(() => {})));
    await render();
    expect(container.textContent).toContain("Upstairs, by the window");
    await act(async () => { vi.advanceTimersByTime(61_000); });
    expect(container.textContent).not.toContain("Upstairs, by the window");
  });

  it("clears a sign after an unsuccessful refresh and shows a retry", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(answer())).mockResolvedValueOnce(Response.json({ error: "The table sign could not be read." }, { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    await render();
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(container.textContent).not.toContain("Upstairs, by the window");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("The table sign could not be read.");
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "Try again")).toBe(true);
  });

  it("keeps the full-screen sign open through a successful background refresh", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json(answer())));
    await render();
    await click("Show table sign full screen");
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Star at The First Pub");
  });

  it("removes a held sign when a refresh does not answer before its deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(answer())).mockImplementation(() => new Promise(() => {})));
    await render();
    await click("Show table sign full screen");
    await act(async () => { vi.advanceTimersByTime(39_000); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).not.toContain("Upstairs, by the window");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("The table sign could not be read.");
  });

});
