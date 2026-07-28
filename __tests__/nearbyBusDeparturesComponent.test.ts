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

    const html = renderToStaticMarkup(
      createElement(NearbyBusDeparturesView, { result }),
    );

    expect(html).toContain("Blackfriars Station");
    expect(html).toContain("Stop B");
    expect(html).toContain("towards King&#x27;s Cross");
    expect(html).toContain("140 m from pub, straight line");
    expect(html).toContain("Outbound to King&#x27;s Cross");
    expect(html).toContain(">3 min<");
    expect(html).not.toMatch(/\bwalk\b/i);
  });

  it("writes unavailable as a failed check rather than an absence of buses", () => {
    const result: NearbyBusDeparturesResult = {
      status: "unavailable",
      generatedAt: "2026-07-28T22:40:00.000Z",
      stops: [],
    };

    const html = renderToStaticMarkup(
      createElement(NearbyBusDeparturesView, { result }),
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
