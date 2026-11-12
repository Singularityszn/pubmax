// @vitest-environment jsdom

import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mates' prices on the venue sheet. Signed out or not yet known reads nothing
// at all; three facts render with the handle, the figure, the drink and the
// day; an empty or failed answer leaves no frame behind.

const state = vi.hoisted(() => ({
  phase: "signed-in" as "signed-in" | "signed-out" | "unresolved",
  respond: null as null | (() => Promise<Response>),
  calls: [] as string[],
}));

vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => ({
    phase: state.phase,
    signedIn: state.phase === "signed-in",
    signedOut: state.phase === "signed-out",
    unresolved: state.phase === "unresolved",
  }),
}));
vi.mock("@/components/auth/authContext", () => ({
  useAuth: () => ({ identityResolved: true }),
}));

vi.mock("@/lib/authedFetch", () => ({
  signedInActionFetch: async (input: string) => {
    state.calls.push(String(input));
    if (!state.respond) throw new Error("no response queued");
    return state.respond();
  },
}));

import { readProviderAccountRevision, setProviderIdentity } from "@/lib/authProviderRevision";

import MatesPricesLine from "@/components/map/MatesPricesLine";
import { matesPriceDay, matesPriceDrink } from "@/lib/matesPrices";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setProviderIdentity("supabase", "account-a");
  setProviderIdentity("clerk", null);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  state.phase = "signed-in";
  state.respond = null;
  state.calls = [];
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setProviderIdentity("supabase", null);
  setProviderIdentity("clerk", null);
  vi.unstubAllGlobals();
});

async function renderLine(venueId = "venue-harp") {
  await act(async () => {
    root.render(createElement(MatesPricesLine, { venueId }));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

describe("MatesPricesLine", () => {
  it("renders nothing and asks nothing for a signed-out or unresolved reader", async () => {
    for (const phase of ["signed-out", "unresolved"] as const) {
      state.phase = phase;
      await renderLine();
      expect(container.innerHTML).toBe("");
    }
    expect(state.calls).toEqual([]);
  });

  it("renders three facts with handle, figure, drink and day", async () => {
    state.respond = async () =>
      json({
        prices: [
          { handle: "sam", priceGbp: 5.2, drink: "Guinness", measure: "pint", loggedAt: daysAgo(0) },
          { handle: "jo", priceGbp: 3.1, drink: "Lager", measure: "half", loggedAt: daysAgo(1) },
          { handle: "kit", priceGbp: 6, drink: "Cider", measure: "pint", loggedAt: daysAgo(40) },
        ],
      });
    await renderLine();

    expect(state.calls).toEqual(["/api/mates-prices?venueId=venue-harp"]);
    const facts = [...container.querySelectorAll("li")].map((li) => li.textContent);
    expect(facts).toEqual([
      "@sam paid £5.20 for Guinness here today",
      "@jo paid £3.10 for a half of Lager here yesterday",
      `@kit paid £6.00 for Cider here ${matesPriceDay(daysAgo(40))}`,
    ]);
    expect(container.querySelector("h4")?.textContent).toBe("Your mates paid");
    // Three dated facts, never a sum or an average.
    expect(container.textContent).not.toMatch(/average|your lot pays/i);
  });

  it("leaves no frame when no mate has logged here or the read fails", async () => {
    state.respond = async () => json({ prices: [] });
    await renderLine();
    expect(container.innerHTML).toBe("");

    state.respond = async () => json({ error: { code: "SOCIAL_SIGN_IN_REQUIRED" } }, 401);
    await renderLine("venue-other");
    expect(container.innerHTML).toBe("");
    expect(container.textContent).not.toMatch(/unknown/i);
  });
});

describe("matesPriceDay and matesPriceDrink", () => {
  const now = new Date("2026-10-30T20:00:00.000Z");

  it("says the London day the way a mate would", () => {
    expect(matesPriceDay("2026-10-30T09:00:00.000Z", now)).toBe("today");
    expect(matesPriceDay("2026-10-29T22:00:00.000Z", now)).toBe("yesterday");
    expect(matesPriceDay("2026-10-24T19:00:00.000Z", now)).toBe("on Saturday");
    expect(matesPriceDay("2026-09-12T19:00:00.000Z", now)).toBe("on 12 Sept");
    expect(matesPriceDay("2025-12-01T19:00:00.000Z", now)).toBe("on 1 Dec 2025");
    expect(matesPriceDay("not a date", now)).toBe("");
  });

  it("names the drink as it was logged", () => {
    expect(matesPriceDrink({ drink: "Guinness", measure: "pint" })).toBe("Guinness");
    expect(matesPriceDrink({ drink: "", measure: "pint" })).toBe("a pint");
    expect(matesPriceDrink({ drink: "Half of lager", measure: "half" })).toBe("Half of lager");
    expect(matesPriceDrink({ drink: "Cider", measure: "other", measureLabel: "Bottle" })).toBe("Cider (bottle)");
    expect(matesPriceDrink({ drink: "", measure: "other" })).toBe("a drink");
  });

  it("says which glass, bottle or spirit measure the price bought", () => {
    expect(matesPriceDrink({ drink: "House white (small)", measure: "125ml" })).toBe("House white (small) (125 ml)");
    expect(matesPriceDrink({ drink: "House white (small)", measure: "175ml" })).toBe("House white (small) (175 ml)");
    expect(matesPriceDrink({ drink: "House white (small)", measure: "250ml" })).toBe("House white (small) (250 ml)");
    expect(matesPriceDrink({ drink: "House white (175ML)", measure: "175ml" })).toBe("House white (175ML)");
    expect(matesPriceDrink({ drink: "House white (175 ml)", measure: "175ml" })).toBe("House white (175 ml)");
    expect(matesPriceDrink({ drink: "House white (125ml)", measure: "175ml" })).toBe("House white (125ml) (175 ml)");
    expect(matesPriceDrink({ drink: "House white (1175ml)", measure: "175ml" })).toBe("House white (1175ml) (175 ml)");
    expect(matesPriceDrink({ drink: "Half of Peroni", measure: "bottle" })).toBe("Half of Peroni (bottle)");
    expect(matesPriceDrink({ drink: "Peroni (BOTTLE)", measure: "bottle" })).toBe("Peroni (BOTTLE)");
    expect(matesPriceDrink({ drink: "Double Jameson", measure: "single" })).toBe("Double Jameson (single)");
    expect(matesPriceDrink({ drink: "Jameson (SINGLE)", measure: "single" })).toBe("Jameson (SINGLE)");
    expect(matesPriceDrink({ drink: "Singleton", measure: "single" })).toBe("Singleton (single)");
    expect(matesPriceDrink({ drink: "Single Jameson", measure: "double" })).toBe("Single Jameson (double)");
    expect(matesPriceDrink({ drink: "Jameson (DOUBLE)", measure: "double" })).toBe("Jameson (DOUBLE)");
    expect(matesPriceDrink({ drink: "Merlot", measure: "175ml" })).toBe("Merlot (175 ml)");
    expect(matesPriceDrink({ drink: "Merlot", measure: "250ml" })).toBe("Merlot (250 ml)");
    expect(matesPriceDrink({ drink: "Peroni", measure: "bottle" })).toBe("Peroni (bottle)");
    expect(matesPriceDrink({ drink: "Jameson", measure: "single" })).toBe("Jameson (single)");
    expect(matesPriceDrink({ drink: "Jameson", measure: "double" })).toBe("Jameson (double)");
    expect(matesPriceDrink({ drink: "", measure: "125ml" })).toBe("a 125 ml glass");
    expect(matesPriceDrink({ drink: "", measure: "bottle" })).toBe("a bottle");
    expect(matesPriceDrink({ drink: "", measure: "double" })).toBe("a double");
  });
});


const prices = (handle: string) => ({ prices: [{ handle, priceGbp: 5, drink: "Lager", measure: "pint", loggedAt: daysAgo(0) }] });

it("hides A's prices in B's first committed render before B's read finishes", async () => {
  const commits: { epoch: number; text: string }[] = [];
  function Probe() {
    useLayoutEffect(() => { commits.push({ epoch: readProviderAccountRevision(), text: container.textContent ?? "" }); });
    return createElement(MatesPricesLine, { venueId: "venue-harp" });
  }
  state.respond = async () => json(prices("alice"));
  await act(async () => root.render(createElement(Probe)));
  expect(container.textContent).toContain("@alice");
  let finishB!: (response: Response) => void;
  state.respond = () => new Promise((resolve) => { finishB = resolve; });
  await act(async () => { setProviderIdentity("supabase", "account-b"); root.render(createElement(Probe)); });
  expect(container.textContent).toBe("");
  expect(commits.filter((row) => row.epoch === readProviderAccountRevision()).every((row) => !row.text.includes("@alice"))).toBe(true);
  await act(async () => finishB(json(prices("bob"))));
  expect(container.textContent).toContain("@bob");
  expect(state.calls).toHaveLength(2);
});

it("ignores A's delayed body after B's replacement read", async () => {
  let finishA!: (body: unknown) => void;
  const responseA = json({});
  vi.spyOn(responseA, "json").mockImplementation(() => new Promise((resolve) => { finishA = resolve; }));
  state.respond = async () => responseA;
  await renderLine();
  state.respond = async () => json(prices("bob"));
  await act(async () => setProviderIdentity("supabase", "account-b"));
  expect(container.textContent).toContain("@bob");
  await act(async () => finishA(prices("alice")));
  expect(container.textContent).toContain("@bob");
  expect(container.textContent).not.toContain("@alice");
});

it("retires prices when the same account signs out and back in", async () => {
  state.respond = async () => json(prices("alice"));
  await renderLine();
  expect(container.textContent).toContain("@alice");
  let finishRead!: (response: Response) => void;
  state.respond = () => new Promise((resolve) => { finishRead = resolve; });
  await act(async () => { setProviderIdentity("supabase", null); setProviderIdentity("supabase", "account-a"); });
  expect(container.textContent).toBe("");
  await act(async () => finishRead(json({ prices: [] })));
  expect(container.textContent).toBe("");
});

it("reads A's prices again after B's failed read without remounting", async () => {
  state.respond = async () => json(prices("alice"));
  await renderLine();
  expect(container.textContent).toContain("@alice");

  state.respond = async () => json({ error: "unavailable" }, 503);
  await act(async () => setProviderIdentity("supabase", "account-b"));
  expect(container.textContent).toBe("");

  let finishA!: (response: Response) => void;
  state.respond = () => new Promise((resolve) => { finishA = resolve; });
  await act(async () => setProviderIdentity("supabase", "account-a"));
  expect(state.calls).toHaveLength(3);
  expect(container.textContent).toBe("");
  await act(async () => finishA(json(prices("alice"))));
  expect(container.textContent).toContain("@alice");
  expect(container.textContent).not.toContain("@bob");
});
