// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PriceHistoryObservation } from "@/lib/priceHistory";
import { buildTimeMachine, ONLY_DATED_LINE, type TimeMachineVenue } from "@/lib/priceTimeMachine";

// The time machine's slider. The engine is replaced by a stand-in that prints
// each pin's state, because what is under test is the page's promise: a year
// change relights the pins, rewrites the count line and the share text, and
// puts the year in the address.

const canvas = vi.hoisted(() => ({
  Stub(props: { venues: TimeMachineVenue[]; lit: Record<string, string> }) {
    return createElement(
      "div",
      { "data-testid": "canvas" },
      props.venues.map((venue) =>
        createElement(
          "span",
          {
            key: venue.venueId,
            className: "stubPin",
            "data-venue": venue.venueId,
            "data-lit": props.lit[venue.venueId] ? "true" : "false",
          },
          props.lit[venue.venueId] ?? "",
        ),
      ),
    );
  },
}));

vi.mock("next/dynamic", () => ({ default: () => canvas.Stub }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("@/components/share/ShareBar", () => ({
  default: (props: { url: string; text: string }) =>
    createElement("div", { className: "stubShare", "data-url": props.url }, props.text),
}));

import TimeMachineClient from "@/app/time-machine/TimeMachineClient";

function obs(venueId: string, priceGbp: number, observedOn: string): PriceHistoryObservation {
  return {
    venueId,
    venueName: venueId,
    priceGbp,
    observedOn,
    source: { label: "beerintheevening.com", url: `https://example.org/${venueId}`, licence: "quoted" },
  };
}

const data = buildTimeMachine(
  [obs("venue-a", 3.1, "2013-06-02"), obs("venue-b", 3.4, "2013-02-01"), obs("venue-a", 4.2, "2016-03-10")],
  (id) => ({ "venue-a": { name: "The Anchor", lat: 51.5, lng: -0.1 }, "venue-b": { name: "The Bell", lat: 51.51, lng: -0.12 } })[id] ?? null,
)!;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState(null, "", "/time-machine?year=2013");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function pins(): Record<string, string> {
  const out: Record<string, string> = {};
  host.querySelectorAll<HTMLElement>(".stubPin").forEach((pin) => {
    out[pin.dataset.venue!] = pin.dataset.lit === "true" ? pin.textContent! : "grey";
  });
  return out;
}

function moveTo(year: number): void {
  const slider = host.querySelector<HTMLInputElement>("input[type=range]")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(slider, String(year));
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("the time machine slider", () => {
  it("opens on the linked year with its pubs lit and the line in view", () => {
    act(() => root.render(createElement(TimeMachineClient, { data, initialYear: 2013 })));
    expect(pins()).toEqual({ "venue-a": "£3.10", "venue-b": "£3.40" });
    expect(host.querySelector(".tmOnlyDated")?.textContent).toBe(ONLY_DATED_LINE);
    expect(host.querySelector(".tmCount")?.textContent).toBe("2 pubs with a dated record in 2013.");
    expect(host.querySelector(".stubShare")?.textContent).toBe("Pints in 2013: 2 pubs with a dated record");
    const slider = host.querySelector<HTMLInputElement>("input[type=range]")!;
    expect(slider.min).toBe("2013");
    expect(slider.max).toBe("2016");
    expect(slider.labels?.[0]?.textContent).toContain("2013");
    expect(slider.getAttribute("aria-valuetext")).toBe("2013, 2 pubs lit");
  });

  it("relights the pins, rewrites the line and puts the year in the address on a change", () => {
    act(() => root.render(createElement(TimeMachineClient, { data, initialYear: 2013 })));
    moveTo(2016);
    expect(pins()).toEqual({ "venue-a": "£4.20", "venue-b": "grey" });
    expect(host.querySelector(".tmCount")?.textContent).toBe("1 pub with a dated record in 2016.");
    expect(host.querySelector(".tmYearValue")?.textContent).toBe("2016");
    expect(window.location.search).toBe("?year=2016");
    expect(host.querySelector(".stubShare")?.getAttribute("data-url")).toBe("/time-machine?year=2016");
    expect([...host.querySelectorAll(".tmRow .tmRowName")].map((el) => el.textContent)).toEqual(["The Anchor"]);
    expect(host.querySelector(".tmOnlyDated")?.textContent).toBe(ONLY_DATED_LINE);

    moveTo(2014);
    expect(pins()).toEqual({ "venue-a": "grey", "venue-b": "grey" });
    expect(host.querySelector(".tmCount")?.textContent).toBe("No pub has a dated record from 2014.");
    expect(host.querySelector(".tmRow")).toBeNull();
    expect(window.location.search).toBe("?year=2014");
  });

  it("links each lit pub to its page on the map", () => {
    act(() => root.render(createElement(TimeMachineClient, { data, initialYear: 2013 })));
    const links = [...host.querySelectorAll<HTMLAnchorElement>("a.tmRowName")].map((a) => a.getAttribute("href"));
    expect(links).toEqual(["/map?sel=venue-a", "/map?sel=venue-b"]);
  });
});
