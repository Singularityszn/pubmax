// @vitest-environment jsdom

// DEFECT (UX sprint, 15 Oct 2026, production, 390x844): the phone pub sheet
// offered two plan doors, "Plan stop" in the peek strip and "Make it Stop 1"
// in the bar below it. Captain's call (16 Oct 2026): one button that follows
// the night. With no crawl being built it is "Make it Stop 1" (hands the pub
// to Plan); with a crawl being built it is "Plan stop" / "In plan". The bar's
// ghost stands down wherever the peek strip shows. A desktop has no peek strip
// and keeps the ghost. Rendered proof is e2e/map-plan-stop-pill.spec.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import VenueStickyBar from "@/components/map/inspector/VenueStickyBar";
import type { Venue } from "@/lib/venues";

const ROOT = join(__dirname, "..");
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

function ruleInMedia(css: string, query: string, selector: string): string {
  const at = css.indexOf(selector);
  expect(at, selector).toBeGreaterThan(-1);
  // The nearest @media above the rule is the one that holds it.
  const media = css.lastIndexOf("@media", at);
  expect(css.slice(media, css.indexOf("{", media)).trim()).toBe(`@media ${query}`);
  return css.slice(at, css.indexOf("}", at));
}

describe("one plan button on the phone pub sheet", () => {
  it("marks the bar's Stop 1 ghost so a phone can stand it down", () => {
    const venue = { id: "venue-test", name: "Arnos Arms", kind: "pub" } as unknown as Venue;
    const view = document.createElement("div");
    view.innerHTML = renderToStaticMarkup(createElement(VenueStickyBar, {
      venue, mode: "suggest", inCrawl: false, onToggleStop: () => {},
      onAcceptStop1: () => {}, shareVenue: async () => {}, currentShareFeedback: null,
    }));
    const ghost = view.querySelector('[aria-label="Make Arnos Arms Stop 1"]');
    expect(ghost?.classList.contains("venueSheetStickyStop1")).toBe(true);
  });

  it("stands the ghost down at the breakpoint that shows the peek strip", () => {
    const rule = ruleInMedia(read("components/map/venueSheet.css"), "(max-width: 640px)", ".venueSheetStickyBar .venueSheetStickyStop1 {");
    expect(rule).toContain("display: none;");
    const shell = read("components/mobile/mobileMapShell.css");
    expect(shell).toMatch(/@media \(min-width: 641px\) \{\s*\.mobileVenuePeekSummary \{ display: none; \}/);
  });

  it("makes the peek's one button follow the crawl being built", () => {
    const pubMap = read("components/PubMap.tsx");
    const start = pubMap.indexOf("function renderVenuePeekSummary(");
    const peek = pubMap.slice(start, pubMap.indexOf("function renderVenuePanel(", start));
    expect(peek).toMatch(/builtIds\.length > 0 \? \(/);
    expect(peek).toContain('"In plan" : "Plan stop"');
    expect(peek).toContain("onClick={acceptStop1}");
    expect(peek).toContain("Make it Stop 1");
    expect(peek.indexOf("toggleBuiltStop")).toBeLessThan(peek.indexOf("onClick={acceptStop1}"));
  });
});
