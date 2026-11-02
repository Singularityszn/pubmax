import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  SIGN_AT_REST,
  SIGN_MIN_NAME_SIZE,
  SIGN_PAINTS,
  SIGN_SHAPES,
  estimateTextEm,
  pubSignSpec,
  pushSign,
  signAtRest,
  signBoardPath,
  signFoundingYear,
  signLetteringName,
  signNameFromAlt,
  signRows,
  signSafeBox,
  signSeed,
  stepSignSwing,
} from "@/lib/wildPubSign";

// THE SIGN FOUNDRY (wild idea 03). The sign is decided by the name alone, so
// these hold the generator to three promises: the same name always draws the
// same sign, the lettering always fits its board, and "Since" is printed only
// for a FOUNDING year the record states.

const PACK = JSON.parse(
  readFileSync(join(process.cwd(), "public", "data", "last_orders", "london_hours.json"), "utf8"),
) as { rows: Array<[string, string, number, number, string, string]> };
const REAL_NAMES = [...new Set(PACK.rows.map((row) => row[1]))].slice(0, 400);

describe("a sign is decided by the name", () => {
  it("draws the same sign for the same name, whatever its case or spacing", () => {
    expect(pubSignSpec("The Dog and Duck")).toEqual(pubSignSpec("The Dog and Duck"));
    expect(signSeed("The  Dog and DUCK ")).toBe(signSeed("the dog and duck"));
    expect(signSeed("The Queen’s Head")).toBe(signSeed("The Queen's Head"));
  });

  it("spreads real pub names across every shape and most paints", () => {
    const shapes = new Set(REAL_NAMES.map((name) => pubSignSpec(name).shape));
    const paints = new Set(REAL_NAMES.map((name) => pubSignSpec(name).paint));
    expect(SIGN_SHAPES.length).toBeGreaterThanOrEqual(4);
    expect([...shapes].sort()).toEqual([...SIGN_SHAPES].sort());
    expect(paints.size).toBe(SIGN_PAINTS.length);
  });

  it("sets a leading The small and letters the rest", () => {
    const spec = pubSignSpec("The Dog and Duck");
    expect(spec.the).toBe(true);
    expect(spec.lines.join(" ")).toBe("Dog and Duck");
    const rows = signRows(spec);
    expect(rows[0]).toMatchObject({ kind: "the", text: "The" });
    expect(pubSignSpec("Bird in Hand").the).toBe(false);
  });

  it("letters the name without a listing's qualifier, and keeps the full name for the label", () => {
    expect(signLetteringName("The Montague Arms (music venue)")).toBe("The Montague Arms");
    expect(signLetteringName("George and Dragon, Shoreditch")).toBe("George and Dragon");
    expect(signLetteringName("Anchor - Bankside (southwark)")).toBe("Anchor - Bankside");
    const spec = pubSignSpec("George and Dragon, Shoreditch");
    expect(spec.name).toBe("George and Dragon, Shoreditch");
    expect(spec.lines.join(" ")).toBe("George and Dragon");
  });
});

describe("the lettering fits its board", () => {
  it("wraps to at most two lines and never letters under the smallest size", () => {
    for (const name of REAL_NAMES) {
      const spec = pubSignSpec(name);
      expect(spec.lines.length, name).toBeGreaterThanOrEqual(1);
      expect(spec.lines.length, name).toBeLessThanOrEqual(2);
      expect(spec.nameSize, name).toBeGreaterThanOrEqual(SIGN_MIN_NAME_SIZE);
      expect(spec.nameSize, name).toBeLessThanOrEqual(34);
    }
  });

  it("estimates every line inside the board's safe width unless it is already at the smallest size", () => {
    for (const name of REAL_NAMES) {
      const spec = pubSignSpec(name);
      if (spec.nameSize <= SIGN_MIN_NAME_SIZE) continue;
      const safe = signSafeBox(spec.shape);
      for (const row of signRows(spec).filter((entry) => entry.kind === "name")) {
        const width = estimateTextEm(row.text) * row.size + row.spacing * Math.max(0, row.text.length - 1);
        expect(width, `${name}: ${row.text}`).toBeLessThanOrEqual(safe.width + 0.5);
      }
    }
  });

  it("keeps every row inside the board's safe height", () => {
    for (const name of [...REAL_NAMES.slice(0, 120), "Prospect of Whitby"]) {
      const spec = pubSignSpec(name, { foundingYear: "1520" });
      const safe = signSafeBox(spec.shape);
      for (const row of signRows(spec)) {
        expect(row.y - row.size * 0.78, `${name}: ${row.text}`).toBeGreaterThanOrEqual(safe.y - 1);
        expect(row.y, `${name}: ${row.text}`).toBeLessThanOrEqual(safe.y + safe.height + 0.5);
      }
    }
  });

  it("prefers one line for a short name and two for a long one", () => {
    expect(pubSignSpec("The Grapes").lines).toEqual(["Grapes"]);
    expect(pubSignSpec("The Crown & Two Chairmen").lines).toHaveLength(2);
  });

  it("draws every shape as a closed outline with real numbers", () => {
    for (const shape of SIGN_SHAPES) {
      for (const inset of [0, 8, 12.5]) {
        const path = signBoardPath(shape, inset);
        expect(path.startsWith("M"), shape).toBe(true);
        expect(path.endsWith("Z"), shape).toBe(true);
        expect(path, shape).not.toMatch(/NaN|Infinity/);
      }
    }
  });
});

describe("Since is a founding year and nothing else", () => {
  it("reads only a founding date known to the year", () => {
    expect(signFoundingYear({ dateType: "founding", datePrecision: "year", dateValue: "1520" })).toBe("1520");
    expect(signFoundingYear({ dateType: "associated_event", datePrecision: "year", dateValue: "1701" })).toBeNull();
    expect(signFoundingYear({ dateType: "construction", datePrecision: "year", dateValue: "1667" })).toBeNull();
    expect(signFoundingYear({ dateType: "founding", datePrecision: "century", dateValue: "18th century" })).toBeNull();
    expect(signFoundingYear(null)).toBeNull();
    expect(signFoundingYear(undefined)).toBeNull();
  });

  it("letters Since only when a founding year is given", () => {
    expect(pubSignSpec("Prospect of Whitby").since).toBeNull();
    const spec = pubSignSpec("Prospect of Whitby", { foundingYear: "1520" });
    expect(spec.since).toBe("Since 1520");
    expect(signRows(spec).at(-1)).toMatchObject({ kind: "since", text: "SINCE 1520" });
    expect(pubSignSpec("Prospect of Whitby", { foundingYear: "c.1520" }).since).toBeNull();
  });
});

describe("the venue sheet's fallback reads the pub from its alt", () => {
  it("knows the alt each photo frame writes, and nothing else", () => {
    expect(signNameFromAlt("The Dog and Duck exterior or pub interior photo")).toBe("The Dog and Duck");
    expect(signNameFromAlt("The French House, outside or in")).toBe("The French House");
    expect(signNameFromAlt("The Lamb, the first stop")).toBe("The Lamb");
    expect(signNameFromAlt("The Lamb, first on Pubs to try")).toBe("The Lamb");
    expect(signNameFromAlt("")).toBeNull();
    expect(signNameFromAlt("Pint at The Lamb shared by sam")).toBeNull();
  });
});

describe("the swing is a damped pendulum", () => {
  it("comes to rest after a push, and never swings past its limit", () => {
    let state = pushSign(SIGN_AT_REST, 24);
    let widest = 0;
    let frames = 0;
    while (!signAtRest(state) && frames < 60 * 30) {
      state = stepSignSwing(state, 1 / 60);
      widest = Math.max(widest, Math.abs(state.angle));
      frames += 1;
    }
    expect(signAtRest(state)).toBe(true);
    expect(frames / 60).toBeLessThan(20);
    expect(widest).toBeGreaterThan(2);
    expect(widest).toBeLessThanOrEqual(11);
  });

  it("swings the way it was pushed, and the plaque lags behind the board", () => {
    const pushed = stepSignSwing(pushSign(SIGN_AT_REST, 20), 0.1);
    expect(pushed.angle).toBeGreaterThan(0);
    expect(pushed.plaque).not.toBe(0);
    expect(Math.sign(stepSignSwing(pushSign(SIGN_AT_REST, -20), 0.1).angle)).toBe(-1);
  });

  it("stays finite through a long frame, as when a tab wakes", () => {
    const state = stepSignSwing(pushSign(SIGN_AT_REST, 60), 5);
    for (const value of Object.values(state)) expect(Number.isFinite(value)).toBe(true);
    expect(Math.abs(state.angle)).toBeLessThanOrEqual(11);
  });
});
