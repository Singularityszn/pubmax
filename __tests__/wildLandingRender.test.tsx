// @vitest-environment jsdom

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ prefetch: () => Promise.resolve() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("@/components/nav/MessagesLink", () => ({ default: () => null }));
vi.mock("@/components/nav/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

import LandingPage from "@/components/landing/LandingPage";
import DotFooter from "@/components/wild/DotFooter";
import PriceGlass from "@/components/wild/PriceGlass";
import type { WildPriceGlass } from "@/lib/wildPriceGlass";
import { writeWildMode } from "@/lib/wildMode";
import { assertNoEagerModules, walkEagerModules } from "./helpers/landingEagerGraph";

// Round-two wild ideas 01 and 10 on the front door. With the wild switch off
// (and on the server, where it always reads off) the landing renders exactly
// as before and fetches neither chunk. With it on, the glass pours real,
// sourced prices and its figure wears the band of the price it shows.

const GLASS: WildPriceGlass = {
  scaleMaxGbp: 10,
  pours: [
    {
      id: "london",
      group: "london",
      chip: "Average",
      title: "London average",
      priceGbp: 5.55,
      what: [{ text: "The average of each pub's cheapest listed pint, across 938 pubs in our London pub list with a listed price." }],
      source: [{ text: "From prices read between 4 July 2026 and 2 October 2026." }],
    },
    {
      id: "cheapest",
      group: "london",
      chip: "Cheapest",
      title: "London's cheapest",
      priceGbp: 2.43,
      what: [
        { text: "The cheapest listed pint in London, at " },
        { text: "J.J. Moon's", href: "/map?sel=venue-cbqtvi" },
        { text: "." },
      ],
      source: [
        { text: "Listed by " },
        { text: "Pint Prices", url: "https://www.pint-prices.com/pub/x" },
        { text: ", source read 2 October 2026." },
      ],
    },
    {
      id: "borough-enfield",
      group: "borough",
      chip: "Enfield",
      title: "Enfield median",
      priceGbp: 4.35,
      what: [{ text: "The median of each pub's cheapest listed pint, across the 13 Enfield pubs in our London pub list with a listed price." }],
      source: [{ text: "From prices read on 2 October 2026." }],
    },
    {
      id: "dearest",
      group: "london",
      chip: "Dearest",
      title: "London's dearest",
      priceGbp: 9.5,
      what: [{ text: "London's dearest pint: the cheapest pint at Baccarat Bar." }],
      source: [{ text: "Listed by Pint Prices, source read 2 October 2026." }],
    },
  ],
};

describe("with the switch off", () => {
  it("renders the landing with no wild markup at all", () => {
    const html = renderToStaticMarkup(createElement(LandingPage, { priceGlass: GLASS }));
    expect(html).not.toContain("wildGlass");
    expect(html).not.toContain("wildDots");
    expect(html).toContain('data-primary-action=""');
  });

  it("prerenders the same document whatever this browser's switch says", () => {
    // The server and the hydrating render read the switch as off
    // (lib/useWildMode.ts), so the one prerendered copy never carries it.
    window.localStorage.setItem("pubmax-wild", "1");
    try {
      const html = renderToStaticMarkup(createElement(LandingPage, { priceGlass: GLASS }));
      expect(html).not.toContain("wildGlass");
      expect(html).toBe(renderToStaticMarkup(createElement(LandingPage, { priceGlass: null })));
    } finally {
      window.localStorage.clear();
    }
  });

  it("shows wild content only while the mounted browser switch is on", async () => {
    // Oracle: the master switch must hide both optional landing ideas by default.
    // This rejects an eager render or content that survives switching off.
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      act(() => root.render(createElement(LandingPage, { priceGlass: GLASS })));
      expect(host.querySelector(".wildGlass")).toBeNull();
      expect(host.querySelector(".wildDots")).toBeNull();
      await act(async () => { writeWildMode(true); });
      await vi.waitFor(() => {
        expect(host.querySelector(".wildGlass")).not.toBeNull();
        expect(host.querySelector(".wildDots")).not.toBeNull();
      });
      act(() => writeWildMode(false));
      expect(host.querySelector(".wildGlass")).toBeNull();
      expect(host.querySelector(".wildDots")).toBeNull();
    } finally {
      act(() => root.unmount());
      window.localStorage.clear();
    }
  });
});

describe("the price glass", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // Reduced motion: the glass shows its final state at once, so the test
    // reads the landed figure rather than a frame of the pour.
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container.remove();
    vi.unstubAllGlobals();
  });

  const figure = () => container.querySelector(".wildGlassFigure")!;
  const chip = (label: string) =>
    [...container.querySelectorAll<HTMLButtonElement>(".wildGlassChips button")].find(
      (button) => button.textContent === label,
    )!;

  it("pours London first, and its figure wears the band of its price", () => {
    act(() => root!.render(createElement(PriceGlass, { glass: GLASS })));
    expect(figure().textContent).toBe("£5.55");
    expect(figure().classList.contains("priceBand-average")).toBe(true);
    expect(container.querySelector('.wildGlassTitle[data-active="true"]')?.textContent).toBe("London average");
    expect(container.querySelector('[data-active="true"] .wildGlassSource')?.textContent).toBe(
      "From prices read between 4 July 2026 and 2 October 2026.",
    );
    expect(chip("Average").getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain("London average: £5.55.");
  });

  it("pours another price when a chip is tapped, with who listed it and when", () => {
    act(() => root!.render(createElement(PriceGlass, { glass: GLASS })));
    act(() => chip("Cheapest").click());
    expect(figure().textContent).toBe("£2.43");
    expect(figure().classList.contains("priceBand-cheap")).toBe(true);
    expect(figure().classList.contains("priceBand-average")).toBe(false);
    expect(chip("Cheapest").getAttribute("aria-pressed")).toBe("true");
    expect(chip("Average").getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelector('[data-active="true"] .wildGlassSource')?.textContent).toBe(
      "Listed by Pint Prices, source read 2 October 2026.",
    );
    expect(container.querySelector('[data-active="true"] .wildGlassWhat a[href="/map?sel=venue-cbqtvi"]')?.textContent).toBe("J.J. Moon's");
    act(() => chip("Dearest").click());
    expect(figure().textContent).toBe("£9.50");
    expect(figure().classList.contains("priceBand-expensive")).toBe(true);
  });

  it("marks London's band edges in their own band classes", () => {
    act(() => root!.render(createElement(PriceGlass, { glass: GLASS })));
    const marks = [...container.querySelectorAll(".wildGlassMark")].map((mark) => ({
      text: mark.textContent,
      band: [...mark.classList].find((name) => name.startsWith("priceBand-")) ?? null,
    }));
    expect(marks).toEqual([
      { text: "£10", band: null },
      { text: "£6.20", band: "priceBand-average" },
      { text: "£5.25", band: "priceBand-cheap" },
      { text: "£0", band: null },
    ]);
  });

  it("shows only the chosen pour's words, and names each row of chips", () => {
    act(() => root!.render(createElement(PriceGlass, { glass: GLASS })));
    act(() => chip("Enfield").click());
    const shown = [...container.querySelectorAll('.wildGlassLines[data-active="true"]')];
    expect(shown).toHaveLength(1);
    expect(shown[0]!.textContent).toContain("13 Enfield pubs");
    expect(container.querySelectorAll('.wildGlassLines[data-active="false"]')).toHaveLength(GLASS.pours.length - 1);
    const rows = [...container.querySelectorAll('.wildGlassChipRow[role="group"]')].map((row) => ({
      name: container.querySelector(`#${CSS.escape(row.getAttribute("aria-labelledby")!)}`)?.textContent,
      chips: [...row.querySelectorAll("button")].map((button) => button.textContent),
    }));
    expect(rows).toEqual([
      { name: "London", chips: ["Average", "Cheapest", "Dearest"] },
      { name: "Borough medians", chips: ["Enfield"] },
    ]);
  });

  it("gives every chip and the glass a tap target the control row promises", () => {
    act(() => root!.render(createElement(PriceGlass, { glass: GLASS })));
    const buttons = container.querySelectorAll(".wildGlassChips button.uiChip");
    expect(buttons).toHaveLength(GLASS.pours.length);
    expect(container.querySelector("button.wildGlassPour")?.getAttribute("aria-label")).toBe(
      "Pour London average again",
    );
  });
});

describe("the dot footer", () => {
  it("names the brand for a screen reader and repeats the landing's own counts", () => {
    const html = renderToStaticMarkup(
      createElement(DotFooter, {
        counts: [
          { figure: "938", words: "pubs in our London pub list with a listed price" },
          { figure: "46,301", words: "UK pub listings from OpenStreetMap" },
        ],
      }),
    );
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="PUBMAXX"');
    expect(html).toContain('<span class="wildDotsCount">938</span> pubs in our London pub list with a listed price.');
    expect(html).toContain('<span class="wildDotsCount">46,301</span> UK pub listings from OpenStreetMap.');
  });

  it("prints no counts line when the landing has no counts", () => {
    const html = renderToStaticMarkup(createElement(DotFooter, { counts: [] }));
    expect(html).not.toContain("wildDotsCounts");
  });
});

describe("the landing's eager widget graph", () => {
  it("keeps optional widget implementations out of the landing's eager graph", () => {
    const root = process.cwd();
    const extensions = ["", ".ts", ".tsx", ".mts", ".cts", ".mjs", ".cjs", ".js", ".jsx", "/index.ts", "/index.tsx"];
    const graph = walkEagerModules(
      join(root, "components/landing/LandingPage.tsx"),
      (file) => /\.(?:ts|tsx|mts|cts|mjs|cjs|js|jsx)$/.test(file) ? readFileSync(file, "utf8") : undefined,
      (from, specifier) => {
        const base = specifier.startsWith("@/") ? join(root, specifier.slice(2)) : specifier.startsWith(".") ? resolve(dirname(from), specifier) : null;
        if (!base) return null;
        return extensions.map((extension) => base + extension).find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
      },
    );
    expect(graph.has(join(root, "components/nav/SiteNav.tsx"))).toBe(true);
    expect(graph.has(join(root, "components/wild/WildNightPreviewGate.tsx"))).toBe(true);
    const implementations = ["PriceGlass", "DotFooter", "WildNightPreviewPicker", "RoundRota", "BoroughBingo", "NightFall", "PalHop", "LastOrdersBell", "PourLoader", "PintLine", "CrawlReceipt", "BeerMats", "PubSign"];
    expect(() => assertNoEagerModules(graph, implementations.map((name) => join(root, `components/wild/${name}.tsx`)))).not.toThrow();
  });

  it("detects an eager widget behind a nested import and ignores a dynamic import", () => {
    const files = new Map([
      ["landing.tsx", 'import "./wrapper";'],
      ["wrapper.tsx", 'import "./PriceGlass";'],
      ["PriceGlass.tsx", "export default function PriceGlass() {}"],
    ]);
    const graph = () => walkEagerModules("landing.tsx", (file) => files.get(file), (_from, specifier) => `${specifier.slice(2)}.tsx`);
    expect(() => assertNoEagerModules(graph(), ["PriceGlass.tsx"])).toThrow("landing.tsx -> wrapper.tsx -> PriceGlass.tsx");
    files.set("wrapper.tsx", 'const PriceGlass = () => import("./PriceGlass");');
    expect(() => assertNoEagerModules(graph(), ["PriceGlass.tsx"])).not.toThrow();
  });
});
