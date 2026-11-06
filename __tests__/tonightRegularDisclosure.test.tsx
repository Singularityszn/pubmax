// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import TonightAnswerCards, { type TonightRegularNightsView } from "@/components/tonight/TonightAnswerCards";
import { regularNightsForWeekday } from "@/lib/regularNights";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("regular nights disclosure", () => {
  afterEach(() => { document.body.replaceChildren(); });

  it("keeps the same disclosure while the read finishes and preserves an opened state", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const render = (regular: TonightRegularNightsView) => createElement(TonightAnswerCards, {
      cheapest: null, listing: null, regular, lastTrain: { status: "no-location" }, onShareLocation: () => {},
    });
    await act(async () => { root.render(render({ status: "loading" })); });
    const details = container.querySelector<HTMLDetailsElement>("details.tonightRegular");
    expect(details?.open).toBe(false);
    expect(details?.querySelector("summary")?.textContent).toContain("Regular nights");
    expect(details?.textContent).toContain("Checking the regular nights");
    await act(async () => { details!.open = true; });
    await act(async () => { root.render(render({ status: "ready", answer: regularNightsForWeekday([], 2) })); });
    expect(container.querySelector("details.tonightRegular")).toBe(details);
    expect(details?.open).toBe(true);
    expect(details?.textContent).toContain("No regular nights recorded");
    await act(async () => { root.unmount(); });
  });

  it("opens the sourced regular-night rows without mixing them into a confirmed listing", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const answer = regularNightsForWeekday([{
      id: "fixture-quiz", kind: "quiz", venueId: "fixture", placeName: "Fixture Arms",
      title: "Pub quiz", weekday: 2, time: "20:00", lat: null, lng: null,
      source: { label: "Fixture menu", url: "https://example.com/menu" },
      readAt: "2026-07-18T12:00:00Z",
    }], 2);
    await act(async () => { root.render(createElement(TonightAnswerCards, {
      cheapest: null, listing: null, regular: { status: "ready", answer },
      lastTrain: { status: "no-location" }, onShareLocation: () => {},
    })); });
    const details = container.querySelector<HTMLDetailsElement>("details.tonightRegular")!;
    expect(details.open).toBe(false);
    await act(async () => { details.querySelector("summary")!.click(); });
    expect(details.open).toBe(true);
    expect(details.textContent).toContain("Fixture Arms");
    expect(details.textContent).toContain("Fixture menu");
    expect(details.textContent).toContain("18 July 2026");
    expect(container.textContent).toContain("No confirmed listings for tonight yet.");
    await act(async () => { root.unmount(); });
  });
});
