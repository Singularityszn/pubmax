// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PubComparisonCatalogue, PubComparisonResponse } from "@/lib/pubComparison";
import { saveComparisonDraft } from "@/lib/pubComparisonDraft";

const session = vi.hoisted(() => ({ accountRevision: 0 }));
vi.mock("@/components/auth/authContext", () => ({
  useAuth: () => ({ user: null, handle: null, identityResolved: true, accountRevision: session.accountRevision }),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import PubComparisonForm from "@/components/tools/PubComparisonForm";

type Pending = { url: string; init: RequestInit; reply: (response: Response) => void };
let pending: Pending[];
let container: HTMLDivElement;
let root: Root;

const order = [{ category: "beer" as const, drinkLabel: "Guinness", serving: "pint", quantity: 1 }];
const pubs = [
  { id: "venue-a", name: "The Crown", address: "1 High Street", borough: "Sutton" },
  { id: "venue-b", name: "The Crown", address: "2 High Street", borough: "Greenwich" },
];
function catalogue(drinkLabel: string): PubComparisonCatalogue {
  return {
    status: "ready", coverage: "ready", venues: pubs,
    drinks: [{ key: drinkLabel, category: "beer", drinkLabel, serving: "pint" }],
    meetingPoints: [{ id: "big-ben", name: "Big Ben" }],
  };
}
function result(totalPence: number): PubComparisonResponse {
  return {
    status: "ready", completeVenueCount: 2, meetingPoint: null,
    venues: pubs.map((pub) => ({
      ...pub, items: [], knownSubtotalPence: totalPence, totalPence,
      walk: { status: "not-requested", minutes: null, method: null, timing: null },
      mapHref: `/map?sel=${pub.id}`,
    })),
  };
}
function latest(method = "GET"): Pending {
  const request = pending.filter((entry) => (entry.init.method ?? "GET") === method).at(-1);
  expect(request).toBeDefined();
  return request!;
}
async function reply(request: Pending, body: unknown, status = 200) {
  await act(async () => { request.reply(Response.json(body, { status })); });
}
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((node) => node.textContent?.trim() === label);
  expect(button, label).toBeTruthy();
  expect(button?.disabled, label).toBe(false);
  await act(async () => { button!.click(); });
}
async function selectMeetingPoint(value: string) {
  const select = container.querySelector<HTMLSelectElement>("#comparison-meeting-point")!;
  await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function render() {
  await act(async () => { root.render(createElement(PubComparisonForm)); });
}

beforeEach(async () => {
  session.accountRevision = 0;
  sessionStorage.clear();
  saveComparisonDraft({ venueIds: ["venue-a", "venue-b"], order }, "guest");
  pending = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit = {}) => new Promise<Response>((resolve) => {
    pending.push({ url, init, reply: resolve });
  })));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await render();
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("comparison request lifecycle", () => {
  it("selects a pub through comparison-scoped search", async () => {
    await reply(latest(), catalogue("Guinness"));
    vi.useFakeTimers();
    try {
      const input = container.querySelector<HTMLInputElement>("#comparison-pub-search")!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Crown Sutton");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(250); });
      const search = latest();
      const url = new URL(search.url, "https://pubmaxxing.com");
      expect(url.pathname).toBe("/api/venue-search");
      expect(url.searchParams.get("scope")).toBe("pub-comparison");
      expect(url.searchParams.get("q")).toBe("Crown Sutton");
      await reply(search, { status: "ready", venues: [{ id: "venue-c", name: "The Crown", area: "Sutton" }] });
      await click("Add The Crown, Sutton");
      expect(container.querySelector('ul[aria-label="Selected pubs"]')?.textContent).toContain("The Crown, Sutton");
      expect(new URL(latest().url, "https://pubmaxxing.com").searchParams.get("venues"))
        .toBe("venue-a,venue-b,venue-c");
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([200, 503])("keeps the newer catalogue after an obsolete status %s response", async (status) => {
    const obsolete = latest();
    expect(obsolete.url).toContain("venue-a%2Cvenue-b");
    expect(obsolete.init.cache).toBe("no-store");
    const remove = container.querySelector<HTMLButtonElement>('ul[aria-label="Selected pubs"] button')!;
    await act(async () => { remove.click(); });
    expect(obsolete.init.signal?.aborted).toBe(true);
    const current = latest();
    expect(current.url).toContain("venues=venue-b");
    expect(current.init.cache).toBe("no-store");
    await reply(current, catalogue("Current lager"));
    expect(container.querySelector("#comparison-drink")?.textContent).toContain("Current lager");
    await reply(obsolete, status === 200 ? catalogue("Obsolete lager") : { error: "Obsolete catalogue failure" }, status);
    expect(container.querySelector("#comparison-drink")?.textContent).toContain("Current lager");
    expect(container.textContent).not.toContain("Obsolete");
    expect(container.textContent).not.toContain("Loading listed drinks");
  });

  it.each([200, 503])("keeps the newer result after an obsolete status %s response", async (status) => {
    await reply(latest(), catalogue("Guinness"));
    await click("Compare these pubs");
    const obsolete = latest("POST");
    expect(obsolete.init.cache).toBe("no-store");
    expect(JSON.parse(obsolete.init.body as string)).toEqual({ venueIds: ["venue-a", "venue-b"], order });
    await selectMeetingPoint("big-ben");
    expect(obsolete.init.signal?.aborted).toBe(true);
    await click("Compare these pubs");
    const current = latest("POST");
    expect(current.init.cache).toBe("no-store");
    expect(JSON.parse(current.init.body as string)).toEqual({ venueIds: ["venue-a", "venue-b"], order, meetingPointId: "big-ben" });
    await reply(current, result(600));
    expect(container.querySelector(".pubComparisonResults")?.textContent).toContain("Listed order total £6.00");
    await reply(obsolete, status === 200 ? result(500) : { error: "Obsolete comparison failure" }, status);
    expect(container.querySelector(".pubComparisonResults")?.textContent).toContain("Listed order total £6.00");
    expect(container.textContent).not.toContain("£5.00");
    expect(container.textContent).not.toContain("Obsolete comparison failure");
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
  });

  it("retires catalogue and result requests when the session changes", async () => {
    const initial = latest();
    await reply(initial, catalogue("Guinness"));
    await click("Compare these pubs");
    const obsolete = latest("POST");
    session.accountRevision = 1;
    await render();
    expect(initial.init.signal?.aborted).toBe(true);
    expect(obsolete.init.signal?.aborted).toBe(true);
    await reply(latest(), catalogue("Current lager"));
    await reply(obsolete, result(500));
    expect(container.querySelector(".pubComparisonResults")).toBeNull();
    expect(container.querySelector("#comparison-drink")?.textContent).toContain("Current lager");
  });
});
