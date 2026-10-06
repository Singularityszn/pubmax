import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import RouteThumbnail from "@/app/crawls/RouteThumbnail";

// The invite page's route preview was a bare shape in a grey box. It now prints
// each stop's number on its pin so it reads against the numbered list beside it;
// the /crawls cards, which pass no numbers, keep the small unlabelled dots.

const POINTS: [number, number][] = [
  [-0.1365, 51.5136],
  [-0.1419, 51.5114],
  [-0.1277, 51.5094],
];

describe("RouteThumbnail stop numbers", () => {
  it("prints one number per pin, in stop order", () => {
    const html = renderToStaticMarkup(
      createElement(RouteThumbnail, { points: POINTS, stopNumbers: [1, 2, 4] }),
    );
    const numbers = [...html.matchAll(/<text[^>]*>(\d+)<\/text>/g)].map((m) => m[1]);
    expect(numbers).toEqual(["1", "2", "4"]);
  });

  it("keeps the small unlabelled dots when no numbers are given", () => {
    const html = renderToStaticMarkup(createElement(RouteThumbnail, { points: POINTS }));
    expect(html).not.toContain("<text");
    expect(html.match(/<circle/g)).toHaveLength(3);
  });

  it("still draws nothing for fewer than two points", () => {
    expect(
      renderToStaticMarkup(
        createElement(RouteThumbnail, { points: [POINTS[0]!], stopNumbers: [1] }),
      ),
    ).toBe("");
  });
});

function pinCentres(points: [number, number][]): (readonly [number, number])[] {
  const html = renderToStaticMarkup(
    createElement(RouteThumbnail, { points, stopNumbers: points.map((_, i) => i + 1) }),
  );
  return [...html.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="7"/g)].map(
    (m) => [Number(m[1]), Number(m[2])] as const,
  );
}

function expectReadablePins(centres: (readonly [number, number])[]): void {
  for (const [x, y] of centres) {
    expect(x).toBeGreaterThanOrEqual(7);
    expect(x).toBeLessThanOrEqual(93);
    expect(y).toBeGreaterThanOrEqual(7);
    expect(y).toBeLessThanOrEqual(93);
  }
  for (let i = 1; i < centres.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      const gap = Math.hypot(centres[i]![0] - centres[j]![0], centres[i]![1] - centres[j]![1]);
      expect(gap).toBeGreaterThanOrEqual(14.5);
    }
  }
}

describe("RouteThumbnail pins for stops that sit close together", () => {
  it("steps a later pin clear of an earlier one so both numbers can be read", () => {
    // Two stops 20 metres apart and one far away: unnudged, pin 2 sits on pin 3.
    const centres = pinCentres([
      [-0.1365, 51.5136],
      [-0.1419, 51.5114],
      [-0.1418, 51.5114],
    ]);
    expect(centres).toHaveLength(3);
    expectReadablePins(centres);
  });

  it("keeps a pin pushed toward the frame edge whole inside the frame", () => {
    // Stops 2 and 3 sit together at the far east edge of the route.
    const centres = pinCentres([
      [-0.1419, 51.5114],
      [-0.1366, 51.5136],
      [-0.1365, 51.5136],
    ]);
    expect(centres).toHaveLength(3);
    expectReadablePins(centres);
  });

  it("keeps every pair apart when one step would land a pin on a third", () => {
    // Three stops bunched at one corner and one far away.
    const centres = pinCentres([
      [-0.1365, 51.5136],
      [-0.1366, 51.5136],
      [-0.1365, 51.5137],
      [-0.1419, 51.5094],
    ]);
    expect(centres).toHaveLength(4);
    expectReadablePins(centres);
  });
});
