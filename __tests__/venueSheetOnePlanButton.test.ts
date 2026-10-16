// @vitest-environment jsdom

// DEFECT (UX sprint, 15 Oct 2026, production, 390x844): the phone pub sheet
// offered two plan doors, "Plan stop" in the peek strip and "Make it Stop 1"
// in the bar below it. Captain's call (16 Oct 2026): one button that follows
// the night. With no crawl being built it is "Make it Stop 1" (hands the pub
// to Plan); with a crawl being built it is "Plan stop" / "In plan", and it
// keeps that meaning until the sheet closes.
//
// What is proved here is the marker the bar emits for the phone rule. The
// rendered result - which button a phone shows, in which state, and where the
// tap lands - is driven in a browser by e2e/map-plan-stop-pill.spec.ts.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import VenueStickyBar from "@/components/map/inspector/VenueStickyBar";
import type { Venue } from "@/lib/venues";

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

  it("paints no primary in the bar, so the sheet's one plan door is elsewhere", () => {
    const venue = { id: "venue-test", name: "Arnos Arms", kind: "pub" } as unknown as Venue;
    const view = document.createElement("div");
    view.innerHTML = renderToStaticMarkup(createElement(VenueStickyBar, {
      venue, mode: "build", inCrawl: false, onToggleStop: () => {},
      onAcceptStop1: () => {}, shareVenue: async () => {}, currentShareFeedback: null,
    }));
    const controls = [...view.querySelectorAll("button, a")];
    expect(controls.map((control) => control.textContent))
      .toEqual(["Make it Stop 1", "Crawl", "Share"]);
    for (const control of controls) {
      expect(control.classList.contains("venueSheetStickyGhost"), control.textContent ?? "")
        .toBe(true);
    }
  });
});
