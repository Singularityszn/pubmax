import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import historicPubs from "@/public/data/historic_pubs.json";
import {
  LONDON_MAP_OUTLINES,
  LONDON_MAP_PINS,
  LONDON_MAP_PUB_COUNT,
  LONDON_MAP_PUB_DOT_COUNT,
  LONDON_MAP_PUB_DOTS,
  LONDON_MAP_VIEWBOX,
} from "@/components/landing/londonMapGeometry";
import { defined } from "@/__tests__/helpers/defined";

// The generated geometry still supplies the historic-pub count printed on the
// landing and OG card. Keep its source data honest and generated, even though
// the front door now shows a London photograph.

type HistoricPub = {
  name: string;
  slug?: string;
  borough?: string;
  lat?: number;
  lng?: number;
  dateLabel?: string;
  datePrecision?: string;
  sourced?: boolean;
};

const pubs = historicPubs as HistoricPub[];

const generated = readFileSync(
  join(process.cwd(), "components/landing/londonMapGeometry.ts"),
  "utf8",
);

/** Size ceiling for the generated data module. */
const MAX_KB = 80;

describe("the landing's generated London data", () => {
  it("stays under the generated module's size ceiling", () => {
    const kb = Buffer.byteLength(generated, "utf8") / 1024;
    expect(kb).toBeLessThan(MAX_KB);
  });

  it("draws a frame, an outline and one dot per historic pub in it", () => {
    expect(LONDON_MAP_VIEWBOX).toMatch(/^0 0 \d+ \d+$/);
    expect(LONDON_MAP_OUTLINES.startsWith("M")).toBe(true);
    // Every dot the drawing paints, plus the ones the pins name, is the count
    // the lede prints, so the words and the picture cannot disagree.
    expect(LONDON_MAP_PUB_DOT_COUNT + LONDON_MAP_PINS.length).toBe(LONDON_MAP_PUB_COUNT);
    expect(LONDON_MAP_PUB_COUNT).toBeGreaterThan(100);
    // ONE path for every dot, not one element each: 293 elements are 293
    // layout objects on the phone this page is trying to paint first.
    expect(LONDON_MAP_PUB_DOTS.startsWith("M")).toBe(true);
    expect(LONDON_MAP_PUB_DOTS.match(/M/g)).toHaveLength(LONDON_MAP_PUB_DOT_COUNT);
  });

  it("names only pubs the heritage dataset holds, with the dataset's own words", () => {
    // The script caps the pins at six; the separation rule and clear writing
    // decide how many the data can seat without labels touching, and today that
    // is five.
    expect(LONDON_MAP_PINS.length).toBeGreaterThanOrEqual(4);
    expect(LONDON_MAP_PINS.length).toBeLessThanOrEqual(6);
    for (const pin of LONDON_MAP_PINS) {
      const pub = pubs.find((row) => row.slug === pin.slug);
      expect(pub, `${pin.slug} is a real historic pub`).toBeTruthy();
      expect(pin.name).toBe(pub?.name);
      // The year comes from the row, never from the picture.
      expect(pin.label).toBe(pub?.dateLabel);
      expect(pub?.sourced).toBe(true);
      expect(["year", "century"]).toContain(pub?.datePrecision);
    }
  });

  it("points two labels on one line away from each other, never at each other", () => {
    for (const [index, pin] of LONDON_MAP_PINS.entries()) {
      for (const other of LONDON_MAP_PINS.slice(index + 1)) {
        if (Math.abs(pin.y - other.y) > 80) continue;
        const left = pin.x <= other.x ? pin : other;
        const right = pin.x <= other.x ? other : pin;
        expect(left.anchor, `${left.name} runs left, away from ${right.name}`).toBe("end");
        expect(right.anchor, `${right.name} runs right, away from ${left.name}`).toBe("start");
      }
    }
  });

  it("keeps the named pins far enough apart that no two labels touch", () => {
    // Four of the oldest dated pubs stand within a few hundred metres of Fleet
    // Street, so a one-per-borough rule still stacked four labels on one spot.
    // Separation is the rule now, measured on the drawing.
    for (const [index, pin] of LONDON_MAP_PINS.entries()) {
      for (const other of LONDON_MAP_PINS.slice(index + 1)) {
        expect(Math.hypot(pin.x - other.x, pin.y - other.y)).toBeGreaterThanOrEqual(150);
      }
    }
  });

  it("seats every pin's writing clear of every named pin and every other pin's writing", () => {
    // A label laid over another label or over a named pin reads as one tangle
    // (site audit 13 Sep 2026, D21). A plain pub dot may sit under the writing,
    // because labels were originally drawn with a halo. The boxes retain the
    // original font measurements so regenerating the data stays deterministic.
    const marks = LONDON_MAP_PINS.map((pin) => ({ x: pin.x, y: pin.y, r: 9.5 }));
    type Box = { left: number; right: number; top: number; bottom: number };
    const writing = (pin: (typeof LONDON_MAP_PINS)[number]): Box[] => {
      const side = pin.anchor === "end" ? -1 : 1;
      const box = (width: number, top: number, bottom: number) => {
        const from = pin.x + side * pin.dx;
        const to = from + side * width;
        return {
          left: Math.min(from, to),
          right: Math.max(from, to),
          top: pin.y + pin.dy + top,
          bottom: pin.y + pin.dy + bottom,
        };
      };
      return [box(pin.name.length * 27 * 0.55, -30, 7), box(pin.label.length * 22 * 0.61, 1, 31)];
    };
    const overlaps = (a: Box, b: Box) =>
      a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    for (const pin of LONDON_MAP_PINS) {
      for (const text of writing(pin)) {
        const covered = marks.filter((mark) =>
          overlaps(text, { left: mark.x - mark.r, right: mark.x + mark.r, top: mark.y - mark.r, bottom: mark.y + mark.r }),
        );
        expect(covered, `${pin.name}'s writing covers ${covered.length} named pins`).toHaveLength(0);
      }
      for (const other of LONDON_MAP_PINS) {
        if (other === pin) continue;
        for (const text of writing(pin)) {
          for (const theirs of writing(other)) {
            expect(overlaps(text, theirs), `${pin.name} runs into ${other.name}`).toBe(false);
          }
        }
      }
    }
  });

  it("keeps every mark inside the frame it draws", () => {
    const [, , width, height] = LONDON_MAP_VIEWBOX.split(" ").map(Number);
    for (const [, x, y] of LONDON_MAP_PUB_DOTS.matchAll(/M(-?[\d.]+) (-?[\d.]+)/g)) {
      expect(Number(x)).toBeGreaterThanOrEqual(-10);
      expect(Number(x)).toBeLessThanOrEqual(defined(width));
      expect(Number(y)).toBeGreaterThanOrEqual(0);
      expect(Number(y)).toBeLessThanOrEqual(defined(height));
    }
    for (const pin of LONDON_MAP_PINS) {
      expect(pin.x).toBeGreaterThanOrEqual(0);
      expect(pin.x).toBeLessThanOrEqual(defined(width));
      expect(pin.y).toBeGreaterThanOrEqual(0);
      expect(pin.y).toBeLessThanOrEqual(defined(height));
      expect(["start", "end"]).toContain(pin.anchor);
    }
  });
});
