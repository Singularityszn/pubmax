// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WhatsOnRow } from "@/lib/whatsOn";

// THE DRY ROUND (launch review B4): a planner option and a Tonight door that
// plan listed alcohol-free stops only, print the alcohol-free price beside the
// pint at every stop, say "too few" in words, and name the thing in words.
// The server half is __tests__/dryRoundGenerate.test.ts.

const listings = vi.hoisted(() => ({ status: "empty", rows: [] as WhatsOnRow[] }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/plan",
  useRouter: () => ({ prefetch: () => Promise.resolve(), push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/nav/NowSegment", () => ({ default: () => null }));
vi.mock("@/app/tonight/TonightConditionsStrip", () => ({ default: () => null }));
vi.mock("@/app/tonight/TonightGetHomeStrip", () => ({ default: () => null }));
vi.mock("@/app/tonight/TonightShareButton", () => ({ default: () => null }));
vi.mock("@/components/desktop/AreaNewsRail", () => ({ default: () => null }));
vi.mock("@/components/out/EditorialRail", () => ({ default: () => null }));
vi.mock("@/components/discovery/DealsTonightLane", () => ({ default: () => null }));
vi.mock("@/components/discovery/MusicTonightLane", () => ({ default: () => null }));
vi.mock("@/components/map/useWhatsOnTonight", () => ({
  useWhatsOnTonight: () => ({ ...listings, sourceFreshnessKind: "unknown", kindObservedAt: {}, retry: vi.fn() }),
}));
vi.mock("@/components/out/useOutListings", () => ({
  useOutListings: () => ({
    body: { status: "ready", listingsStatus: "ready", events: [], venueMatch: "ready" },
    failed: false,
    pending: false,
    retry: vi.fn(),
  }),
}));

import TonightClient from "@/app/tonight/TonightClient";
import PlanDescribeFirst from "@/components/plan/PlanDescribeFirst";
import PlanDryRoundLedger from "@/components/plan/PlanDryRoundLedger";
import {
  cleanDryRoundPrices,
  DRY_ROUND_ANCHOR_UNLISTED_LINE,
  DRY_ROUND_LABEL,
  DRY_ROUND_NOTE,
  DRY_ROUND_UNREAD_LINE,
  dryRoundFromSearch,
  dryRoundListedPrices,
  dryRoundPlanHref,
  dryRoundQuery,
  dryRoundSelection,
  dryRoundTooFewLine,
  dryRoundWire,
  isDryRoundAsk,
  type DryRoundStopPrices,
} from "@/lib/dryRound";
import type { NearDrinkRow } from "@/lib/nearCheapestAnything";
import { inferNightContext } from "@/lib/nightPlanning";

describe("the ask", () => {
  it("adds the words the generator reads, once, and keeps a dry round the reader typed", () => {
    expect(dryRoundQuery("Clapham for 3")).toBe("Clapham for 3, an alcohol-free dry round");
    expect(dryRoundQuery("Clapham for 3.")).toBe("Clapham for 3, an alcohol-free dry round");
    expect(dryRoundQuery(dryRoundQuery("Clapham for 3"))).toBe("Clapham for 3, an alcohol-free dry round");
    expect(dryRoundQuery("a dry round in Soho")).toBe("a dry round in Soho");
    expect(dryRoundQuery("   ")).toBe("");
  });

  it("is read as a dry round, and as an alcohol-free night, on the one inference path", () => {
    const ask = dryRoundQuery("Quiet in Clapham for 4");
    expect(isDryRoundAsk(ask)).toBe(true);
    expect(isDryRoundAsk("Dry-round in Camden")).toBe(true);
    expect(isDryRoundAsk("dry January in Camden")).toBe(false);
    expect(isDryRoundAsk("a round in Camden")).toBe(false);
    expect(inferNightContext(ask).context).toMatchObject({ zeroProof: true, nightArea: "clapham", groupSize: 4 });
  });

  it("opens the planner with the Dry round on from another surface", () => {
    expect(dryRoundPlanHref("tonight-vibes")).toBe("/plan?dry=1&src=tonight-vibes");
    expect(dryRoundFromSearch("?dry=1&src=tonight-vibes")).toBe(true);
    expect(dryRoundFromSearch("?dry=0")).toBe(false);
    expect(dryRoundFromSearch("?occasion=af")).toBe(false);
  });
});

describe("which listed price a pub shows, and which pubs may be stops", () => {
  const rows: NearDrinkRow[] = [
    ["a", 3.2, "2026-09-21", "a.example", "Cheaper, size unstated", null],
    ["a", 4.9, "2026-09-21", "a.example", "Lucky Saint", "bottle"],
    ["a", 5.5, "2026-09-21", "a.example", "Guinness alcohol-free", "pint"],
    ["b", 4.5, "2026-09-21", null, "Erdinger", null],
    ["b", 4.2, "2026-09-21", null, "Becks Blue", null],
    ["c", 0, "2026-09-21", "c.example", "Free sample", "bottle"],
  ];

  it("takes the first stated measure, never comparing two measures by price", () => {
    const listed = dryRoundListedPrices(rows);
    // The unstated row is cheaper, but a stated pint is a different answer and
    // is never weighed against it: the measured row leads.
    expect(listed.get("a")).toMatchObject({ priceGbp: 5.5, measure: "pint", drinkLabel: "Guinness alcohol-free" });
    // Within one measure the lower price wins.
    expect(listed.get("b")).toMatchObject({ priceGbp: 4.2, measure: null, publisher: null });
    // A figure that is not a price is not a listing.
    expect(listed.has("c")).toBe(false);
  });

  it("keeps only listed pubs, in the generator's order, and never pads", () => {
    const listed = dryRoundListedPrices(rows);
    const candidates = ["x", "b", "y", "a"].map((id) => ({ venue: { id, name: `The ${id}` } }));
    expect(dryRoundSelection(candidates, listed, 2)).toEqual({
      ok: true,
      candidates: [candidates[1], candidates[3]],
    });
    expect(dryRoundSelection(candidates, listed, 3)).toEqual({ ok: false, listedNames: ["The b", "The a"] });
  });

  it("says too few in words, naming the pubs and what would work", () => {
    expect(dryRoundTooFewLine({ areaName: "Camden", stopCount: 3, listedNames: ["The Black Cap"] })).toBe(
      "Only The Black Cap in Camden lists an alcohol-free price, too few for a 3-stop dry round. Try 1 stop, or another area.",
    );
    expect(dryRoundTooFewLine({ areaName: "Soho", stopCount: 4, listedNames: ["The A", "The B", "The C"] })).toBe(
      "Only The A, The B and The C in Soho list an alcohol-free price, too few for a 4-stop dry round. Try 3 stops, or another area.",
    );
    expect(dryRoundTooFewLine({ areaName: "Balham", stopCount: 3, listedNames: [] })).toBe(
      "No pub in Balham lists an alcohol-free price yet, so there is no dry round to plan there. Try another area.",
    );
  });
});

describe("the wire", () => {
  it("carries the pint only where it names its publisher and day, and reads back defensively", () => {
    const listed = dryRoundListedPrices([["a", 4.9, "2026-09-21", "a.example", "Lucky Saint", "bottle"]]);
    const wire = dryRoundWire(["a", "a", "missing"], listed, new Map([
      ["a", { pence: 610, source: { label: "Pint Prices", observedAt: "2026-10-02T12:00:00.000Z" } }],
    ]));
    expect(wire.venues).toHaveLength(1);
    expect(cleanDryRoundPrices(JSON.parse(JSON.stringify(wire)))?.get("a")).toEqual({
      alcoholFree: { priceGbp: 4.9, drinkLabel: "Lucky Saint", measure: "bottle", publisher: "a.example", observedOn: "2026-09-21" },
      pint: { pence: 610, publisher: "Pint Prices", observedAt: "2026-10-02T12:00:00.000Z" },
    });
    const noPint = dryRoundWire(["a"], listed, new Map([["a", { pence: 610, source: null }]]));
    expect(noPint.venues[0]?.pint).toBeNull();
    expect(cleanDryRoundPrices(null)).toBeNull();
    expect(cleanDryRoundPrices({ venues: [{ venueId: "a", alcoholFree: { priceGbp: -1 } }] })?.size).toBe(0);
    expect(cleanDryRoundPrices({ venues: [{ venueId: "a", alcoholFree: { priceGbp: 4, measure: "jug" } }] })?.size).toBe(0);
  });
});

const PRICES = new Map<string, DryRoundStopPrices>([
  ["a", {
    alcoholFree: { priceGbp: 4.9, drinkLabel: "Lucky Saint", measure: "bottle", publisher: "a.example", observedOn: "2026-09-21" },
    pint: { pence: 610, publisher: "Pint Prices", observedAt: "2026-10-02T12:00:00.000Z" },
  }],
  ["b", {
    alcoholFree: { priceGbp: 4.2, drinkLabel: "Becks Blue", measure: null, publisher: null, observedOn: null },
    pint: null,
  }],
]);

function renderLedger(prices: ReadonlyMap<string, DryRoundStopPrices> = PRICES): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(PlanDryRoundLedger, {
    prices,
    stops: [
      { venueId: "a", venueName: "The A" },
      { venueId: "b", venueName: "The B" },
      { venueId: "c", venueName: "The C" },
    ],
  }));
  return host;
}

describe("the dry round under the stops", () => {
  it("prints the alcohol-free price beside the pint at every stop, each with its source", () => {
    const rows = [...renderLedger().querySelectorAll("li")].map((row) => row.textContent);
    expect(rows[0]).toBe(
      "1. The AAlcohol-free £4.90 Lucky Saint · BottleOn record · a.example · read 21 SeptPint £6.10 On record · Pint Prices · read 2 Oct",
    );
    expect(rows[1]).toBe(
      "2. The BAlcohol-free £4.20 Becks Blue · Size not statedOn record · Publisher not recordedPint No listed pint price",
    );
    // A pub added by hand that lists none says so, rather than borrowing a figure.
    expect(rows[2]).toBe("3. The CNo listed alcohol-free price for this pub.");
  });

  it("keeps a drink's own branded name as its source printed it", () => {
    const branded = new Map(PRICES);
    branded.set("a", { ...PRICES.get("a")!, alcoholFree: { ...PRICES.get("a")!.alcoholFree, drinkLabel: "Corona Cero 0.0% 330ml" } });
    expect(renderLedger(branded).textContent).toContain("Corona Cero 0.0% 330ml");
  });
});

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  host?.remove();
  host = null;
  window.history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
});

function button(label: string): HTMLButtonElement {
  return [...host!.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent === label)!;
}

async function renderDescribeFirst(initialQuery: string, onSubmit: (query: string) => void) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(PlanDescribeFirst, { onSubmit, onGuideMeInstead: () => undefined, initialQuery }));
  });
  await act(async () => { await Promise.resolve(); });
}

describe("the Dry round option on the planner", () => {
  it("sends the ask as typed while it is off", async () => {
    const onSubmit = vi.fn();
    await renderDescribeFirst("Quiet in Clapham for 4", onSubmit);
    expect(button(DRY_ROUND_LABEL).getAttribute("aria-pressed")).toBe("false");
    expect(host!.textContent).toContain(DRY_ROUND_NOTE);
    await act(async () => button("Plan it").click());
    expect(onSubmit).toHaveBeenCalledWith("Quiet in Clapham for 4", 3);
  });

  it("adds the dry round to the ask once tapped, and rides beside the £20 crawl", async () => {
    const onSubmit = vi.fn();
    await renderDescribeFirst("Quiet in Clapham for 4", onSubmit);
    await act(async () => button(DRY_ROUND_LABEL).click());
    expect(button(DRY_ROUND_LABEL).getAttribute("aria-pressed")).toBe("true");
    await act(async () => button("Plan it").click());
    expect(onSubmit).toHaveBeenLastCalledWith("Quiet in Clapham for 4, an alcohol-free dry round", 3);
    await act(async () => button("£20 crawl").click());
    await act(async () => button("Plan it").click());
    expect(onSubmit).toHaveBeenLastCalledWith("Quiet in Clapham for 4, an alcohol-free dry round, a £20 crawl", 3);
  });

  it("arrives on from Tonight's door, and the server paint leaves it off", async () => {
    window.history.replaceState({}, "", dryRoundPlanHref("tonight-vibes"));
    const paint = document.createElement("div");
    paint.innerHTML = renderToStaticMarkup(createElement(PlanDescribeFirst, { onSubmit: () => undefined, onGuideMeInstead: () => undefined }));
    const painted = [...paint.querySelectorAll("button")].find((candidate) => candidate.textContent === DRY_ROUND_LABEL);
    expect(painted?.getAttribute("aria-pressed")).toBe("false");

    const onSubmit = vi.fn();
    await renderDescribeFirst("Camden for 3", onSubmit);
    expect(button(DRY_ROUND_LABEL).getAttribute("aria-pressed")).toBe("true");
    await act(async () => button("Plan it").click());
    expect(onSubmit).toHaveBeenCalledWith("Camden for 3, an alcohol-free dry round", 3);
    // The reader's own tap still turns it off.
    await act(async () => button(DRY_ROUND_LABEL).click());
    expect(button(DRY_ROUND_LABEL).getAttribute("aria-pressed")).toBe("false");
  });
});

describe("the Dry round door on Tonight", () => {
  it.each([
    ["a quiet hour", true],
    ["a busy hour", false],
  ])("opens the planner with the Dry round on in %s", (_label, softPlansWindow) => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(createElement(TonightClient, { softPlansWindow }));
    const vibes = container.querySelector('[role="group"][aria-label="What’s the vibe tonight"]');
    expect(vibes).not.toBeNull();
    const doors = [...vibes!.querySelectorAll("a")].filter((link) => link.textContent === DRY_ROUND_LABEL);
    expect(doors).toHaveLength(1);
    expect(doors[0]?.getAttribute("href")).toBe("/plan?dry=1&src=tonight-vibes");
  });
});

// THE NAME FENCE. Every word that names the dry round says "alcohol-free" or
// "Dry round", never "0.0" and never "zero". It reads the copy a reader can
// meet, string literals and JSX text through the AST, so a comment or an
// identifier is not copy. A drink's own name from its source is not ours to
// rename, which the ledger test above pins.
const NAMING = /0\.0|\bzero\b/i;

function copyIn(file: string): string[] {
  const source = readFileSync(join(process.cwd(), file), "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const copy: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)
      || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) copy.push(node.text);
    if (ts.isJsxText(node) && node.text.trim()) copy.push(node.text.trim());
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return copy;
}

describe("the dry round is named in words", () => {
  it("keeps 0.0 and zero out of every string its own files can show", () => {
    for (const file of ["lib/dryRound.ts", "components/plan/PlanDryRoundLedger.tsx"]) {
      const copy = copyIn(file);
      expect(copy.length, `${file} has no copy to read`).toBeGreaterThan(3);
      expect(copy.filter((text) => NAMING.test(text)), file).toEqual([]);
    }
  });

  it("says alcohol-free or Dry round in every line that names it", () => {
    const lines = [
      DRY_ROUND_LABEL,
      DRY_ROUND_NOTE,
      DRY_ROUND_UNREAD_LINE,
      DRY_ROUND_ANCHOR_UNLISTED_LINE,
      dryRoundQuery("Camden for 3"),
      dryRoundTooFewLine({ areaName: "Camden", stopCount: 3, listedNames: ["The Black Cap"] }),
      dryRoundTooFewLine({ areaName: "Camden", stopCount: 3, listedNames: [] }),
      renderLedger().querySelector("h2")?.textContent ?? "",
      renderLedger().querySelector("p")?.textContent ?? "",
    ];
    for (const line of lines) {
      expect(line, line).toMatch(/alcohol-free|dry round/i);
      expect(line, line).not.toMatch(NAMING);
      expect(line, line).not.toMatch(/—|!/);
    }
  });
});
