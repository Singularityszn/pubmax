// @vitest-environment jsdom

import { act, createElement } from "react";
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

vi.mock("@/lib/authedFetch", () => ({
  authedFetch: async (input: string) => {
    state.calls.push(String(input));
    if (!state.respond) throw new Error("no response queued");
    return state.respond();
  },
}));

import MatesPricesLine from "@/components/map/MatesPricesLine";
import { matesPriceDay, matesPriceDrink } from "@/lib/matesPrices";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
});
