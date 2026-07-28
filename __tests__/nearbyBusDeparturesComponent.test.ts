import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import NearbyBusDepartures, {
  NearbyBusDeparturesView,
  nearbyBusDeparturesFetchUrl,
} from "@/components/map/NearbyBusDepartures";
import type { NearbyBusDeparturesResult } from "@/lib/nearbyBusDepartures";

const result: NearbyBusDeparturesResult = {
  status: "ready",
  generatedAt: "2026-07-28T22:40:00.000Z",
  stops: [
    {
      id: "490000123B",
      name: "Blackfriars Station",
      indicator: "Stop B",
      towards: "King's Cross",
      distanceM: 140,
      departures: [
        {
          lineName: "63",
          destinationName: "King's Cross",
          direction: "outbound",
          expectedArrival: "2026-07-28T22:43:00.000Z",
          dueMinutes: 3,
        },
      ],
    },
  ],
};

function render(at: string, shown: NearbyBusDeparturesResult = result): string {
  return renderToStaticMarkup(
    createElement(NearbyBusDeparturesView, { result: shown, now: new Date(at) }),
  );
}

function arrivingAt(iso: string): NearbyBusDeparturesResult {
  return {
    ...result,
    stops: [
      {
        ...result.stops[0],
        departures: [{ ...result.stops[0].departures[0], expectedArrival: iso }],
      },
    ],
  };
}

describe("NearbyBusDepartures", () => {
  it("starts as one collapsed getting-home control without preloading departures", () => {
    const html = renderToStaticMarkup(
      createElement(NearbyBusDepartures, { lat: 51.512, lng: -0.104 }),
    );

    expect(html).toContain("<details");
    expect(html).not.toContain("<details open");
    expect(html).toContain("Buses nearby");
    expect(html).not.toContain("King&#x27;s Cross");
    expect(nearbyBusDeparturesFetchUrl(51.512, -0.104)).toBe(
      "/api/nearby-bus-departures?lat=51.512&lng=-0.104",
    );
  });

  it("shows stop distance, stop direction, service direction, and due time", () => {
    const html = render("2026-07-28T22:40:00.000Z");

    expect(html).toContain("Blackfriars Station");
    expect(html).toContain("Stop B");
    expect(html).toContain("towards King&#x27;s Cross");
    expect(html).toContain("140 m from here, straight line");
    expect(html).toContain("Outbound to King&#x27;s Cross");
    expect(html).toContain(">3 min<");
    expect(html).not.toMatch(/\bwalk\b/i);
  });

  it("words the card for any kind of venue it is shown on", () => {
    const card = renderToStaticMarkup(
      createElement(NearbyBusDepartures, { lat: 51.512, lng: -0.104 }),
    );

    expect(card).toContain("stops near here");
    expect(card).not.toMatch(/\bpub\b/i);
    expect(render("2026-07-28T22:40:00.000Z")).not.toMatch(/\bpub\b/i);
  });

  it("counts a departure down as time passes instead of freezing what it first said", () => {
    expect(render("2026-07-28T22:40:00.000Z")).toContain(">3 min<");
    expect(render("2026-07-28T22:41:10.000Z")).toContain(">2 min<");
    expect(
      render("2026-07-28T22:41:10.000Z", arrivingAt("2026-07-28T22:41:00.000Z")),
    ).toContain(">Due<");
  });

  it("names the age of a check that is getting on", () => {
    const html = render("2026-07-28T22:41:10.000Z");

    expect(html).toContain("Checked about a minute ago");
    expect(html).not.toMatch(/out of date/i);
  });

  it("stops counting down once the check is too old to stand behind", () => {
    const html = render("2026-07-28T22:43:30.000Z");

    expect(html).toContain("These times are out of date");
    expect(html).toContain("Checked about 3 minutes ago");
    expect(html).toContain(">23:43<");
    expect(html).not.toMatch(/\d+ min</);
    expect(html).not.toContain(">Due<");
  });

  it("writes unavailable as a failed check rather than an absence of buses", () => {
    const html = renderToStaticMarkup(
      createElement(NearbyBusDeparturesView, {
        result: {
          status: "unavailable",
          generatedAt: "2026-07-28T22:40:00.000Z",
          stops: [],
        },
        now: new Date("2026-07-28T22:40:00.000Z"),
      }),
    );

    expect(html).toContain("Couldn&#x27;t check nearby buses just now");
    expect(html).not.toMatch(/no buses/i);
  });

  it("keeps the summary thumb-sized and adds no motion", () => {
    const css = readFileSync(
      join(process.cwd(), "components/map/nearbyBusDepartures.css"),
      "utf8",
    );
    const summaryRule =
      css.match(/\.nearbyBusDeparturesSummary\s*{([^}]*)}/)?.[1] ?? "";

    expect(summaryRule).toMatch(/min-height:\s*44px/);
    expect(css).not.toMatch(/\banimation\s*:/);
    expect(css).not.toMatch(/\btransition\s*:/);
  });
});
