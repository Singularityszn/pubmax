// @vitest-environment jsdom
//
// BEER MATS THAT FLIP (round-two wild idea 06): with the wild switch on,
// Tonight's cheapest listed pints are beer mats (components/wild/BeerMats.tsx).
// Each is a real button saying the pub and the price, its back says the drink
// and who listed it from that pub's own record, and nothing on it is invented.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss, { type AtRule, type Declaration, type Rule } from "postcss";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TonightCheapPints from "@/app/tonight/TonightCheapPints";
import BeerMats, { matRim, matSourceFromDetail } from "@/components/wild/BeerMats";
import type { TonightCheapPint } from "@/lib/tonightCheapPints";
import { clearSurfaceCache } from "@/lib/surfaceDataCache";
import { WILD_MODE_STORAGE_KEY } from "@/lib/wildMode";

const READ = "2026-10-02T11:48:33.000Z";

const ROWS: TonightCheapPint[] = [
  { venueId: "venue-o98nz5", name: "J.J. Moon's", borough: "Wandsworth", priceGbp: 2.09, chain: "wetherspoon", observedAt: READ },
  { venueId: "venue-19vregq", name: "Nags Head, Peckham", borough: "Southwark", priceGbp: 2.9, chain: null, observedAt: READ },
  { venueId: "venue-unread", name: "The Unread", borough: "Camden", priceGbp: 4.5, chain: null, observedAt: null },
];

const DETAIL: Record<string, unknown> = {
  "venue-o98nz5": {
    venue: {
      prices: [
        { pint_name: "Jaipur", price_gbp: 2.09, pub_url: "https://www.pint-prices.com/pub/x/J.J.%20Moons", scraped_at_values: "2026-10-02T11:48:33+00:00" },
        { pint_name: "Guinness", price_gbp: 3.32, pub_url: "https://www.pint-prices.com/pub/x", scraped_at_values: "2026-10-02T11:48:33+00:00" },
      ],
    },
  },
  "venue-19vregq": { venue: { prices: [{ pint_name: "John Smiths", price_gbp: 2.9 }] } },
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const id = decodeURIComponent(/\/api\/venue\/([^?]+)/.exec(url)?.[1] ?? "");
      const body = DETAIL[id];
      return body
        ? new Response(JSON.stringify(body), { status: 200 })
        : new Response("{}", { status: 404 });
    }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  window.localStorage.clear();
  clearSurfaceCache();
  vi.unstubAllGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe("the rim", () => {
  it("runs a short name twice and a long one once, ending on its separator", () => {
    const short = matRim({ ...ROWS[0]!, name: "Ship", borough: "Wapping", chain: null });
    expect(short.text).toBe("SHIP · WAPPING · SHIP · WAPPING · ");
    const long = matRim(ROWS[0]!);
    expect(long.text).toBe("J.J. MOON'S · WANDSWORTH · WETHERSPOON · ");
  });

  it("keeps the type inside its bounds, and spreads it only when it has room", () => {
    for (const row of ROWS) {
      const rim = matRim(row);
      expect(rim.fontSize).toBeGreaterThanOrEqual(9);
      expect(rim.fontSize).toBeLessThanOrEqual(17);
    }
    const roomy = matRim({ ...ROWS[0]!, name: "Ship", borough: "Wapping", chain: null });
    expect(roomy.fontSize).toBe(17);
    expect(roomy.lengthAdjust).toBe("spacing");
    const huge = matRim({
      ...ROWS[1]!,
      name: "The Very Long Named Old Public House and Dining Rooms of the Parish of St Mary",
    });
    expect(huge.lengthAdjust).toBe("spacingAndGlyphs");
    expect(huge.fontSize).toBe(9);
  });

  it("turns the ring so the pub's name sits across the top", () => {
    const { text, turn } = matRim(ROWS[1]!);
    const share = "Nags Head, Peckham".length / text.length;
    // The ring starts at nine o'clock and runs clockwise: the name's middle
    // lands at twelve.
    expect(turn + share * 180).toBeCloseTo(90, 0);
  });
});

describe("the back's source", () => {
  it("reads the drink and the publisher off the row behind the printed figure", () => {
    expect(matSourceFromDetail(DETAIL["venue-o98nz5"], 2.09)).toEqual({
      state: "read",
      drink: "Jaipur",
      publisher: "Pint Prices",
    });
  });

  it("says no publisher was recorded when the row names none", () => {
    expect(matSourceFromDetail(DETAIL["venue-19vregq"], 2.9)).toEqual({
      state: "read",
      drink: "John Smiths",
      publisher: null,
    });
  });

  it("claims nothing when the row is not there", () => {
    expect(matSourceFromDetail(DETAIL["venue-o98nz5"], 9.99)).toEqual({ state: "unavailable" });
    expect(matSourceFromDetail(null, 2.09)).toEqual({ state: "unavailable" });
  });
});

describe("the mats", () => {
  it("makes each mat a pressable button that names the pub and the price", async () => {
    act(() => root.render(createElement(BeerMats, { rows: ROWS })));
    await settle();
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("button.beerMatToggle")];
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "J.J. Moon's, Wandsworth, Wetherspoon, £2.09",
      "Nags Head, Peckham, Southwark, £2.90",
      "The Unread, Camden, £4.50",
    ]);
    for (const button of buttons) expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("prints the price in its band, with the read day beside it", async () => {
    act(() => root.render(createElement(BeerMats, { rows: ROWS })));
    await settle();
    const first = host.querySelector(".beerMat")!;
    const price = first.querySelector(".beerMatFront .beerMatPrice")!;
    expect(price.textContent).toBe("£2.09");
    expect([...price.classList].some((name) => /^priceBand-(cheap|average|expensive)$/.test(name))).toBe(true);
    expect(first.querySelector(".beerMatFront time")?.getAttribute("dateTime")).toBe(READ);
    // The back prints the same figure through the one price badge.
    expect(first.querySelector(".beerMatBack .price-plaque")?.textContent).toBe("£2.09");
  });

  it("turns over on a press, and only the face that is up can be reached", async () => {
    act(() => root.render(createElement(BeerMats, { rows: ROWS })));
    await settle();
    const mat = host.querySelector<HTMLElement>(".beerMat")!;
    const button = mat.querySelector<HTMLButtonElement>("button.beerMatToggle")!;
    const back = mat.querySelector<HTMLElement>(".beerMatBack")!;
    expect(back.hasAttribute("inert")).toBe(true);
    act(() => button.click());
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(mat.hasAttribute("data-flipped")).toBe(true);
    expect(back.hasAttribute("inert")).toBe(false);
    act(() => button.click());
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(back.hasAttribute("inert")).toBe(true);
  });

  it("says the drink, who listed it and when, and opens the pub's price log", async () => {
    act(() => root.render(createElement(BeerMats, { rows: ROWS })));
    await settle();
    const [moon, nags, unread] = [...host.querySelectorAll<HTMLElement>(".beerMatBack")];
    expect(moon?.querySelector(".beerMatDrink")?.textContent).toBe("Jaipur");
    expect(moon?.querySelector(".beerMatSource")?.textContent).toBe("Listed by Pint Prices2 Oct 2026");
    expect(moon?.querySelector("a.beerMatLog")?.getAttribute("href")).toBe("/map?sel=venue-o98nz5&log=1");
    expect(moon?.querySelector("a.beerMatLog")?.textContent).toBe("Paid less? Log it");
    expect(nags?.querySelector(".beerMatSource")?.textContent).toBe("No publisher recorded2 Oct 2026");
    // A pub whose record could not be read names no drink and no publisher.
    expect(unread?.querySelector(".beerMatDrink")).toBeNull();
    expect(unread?.querySelector(".beerMatSource")?.textContent).toBe(
      "Publisher could not be checkedRead day not recorded",
    );
  });
});

describe("Tonight's cheapest pints and the switch", () => {
  it("keeps the list, and the quiet-night rule, with the switch off", async () => {
    act(() => root.render(createElement(TonightCheapPints, { rows: ROWS, show: false })));
    await settle();
    expect(host.innerHTML).toBe("");
    act(() => root.render(createElement(TonightCheapPints, { rows: ROWS })));
    await settle();
    expect(host.querySelector(".beerMats")).toBeNull();
    expect(host.querySelectorAll(".tonightCheapPintsBeltList li")).toHaveLength(3);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("lays the mats on any night with the switch on", async () => {
    window.localStorage.setItem(WILD_MODE_STORAGE_KEY, "1");
    act(() => root.render(createElement(TonightCheapPints, { rows: ROWS, show: false })));
    await settle();
    expect(host.querySelectorAll(".beerMats button.beerMatToggle")).toHaveLength(3);
    expect(host.querySelector(".pintBelt")).toBeNull();
  });
});

describe("the mats' stylesheet", () => {
  const css = readFileSync(join(process.cwd(), "components/wild/beerMats.css"), "utf8");

  it("moves only for readers who have not asked for less motion", () => {
    postcss.parse(css).walkDecls((decl: Declaration) => {
      if (!/^(animation|animation-name|transition|transition-property)$/.test(decl.prop)) return;
      const media: string[] = [];
      for (let node = decl.parent; node && node.type !== "root"; node = node.parent) {
        if (node.type === "atrule" && (node as AtRule).name === "media") media.push((node as AtRule).params);
      }
      expect(media, (decl.parent as Rule).selector).toContain("(prefers-reduced-motion: no-preference)");
    });
  });

  it("steps the list back only while the mats are on the page", () => {
    expect(css).toContain(".tonightCheapPintsAnswer:has(> .beerMats) > .tonightCheapPintsBeltList");
  });

  it("swipes as a snap row on a phone", () => {
    expect(css).toMatch(/@media \(max-width: 640px\) \{\s*\.beerMats \{[^}]*scroll-snap-type: x mandatory;/);
  });
});
