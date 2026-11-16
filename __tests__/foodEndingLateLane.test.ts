import { describe, expect, it } from "vitest";

import { foodEndingSelection } from "@/components/night/NightModeCard";
import {
  lateFoodNearMapUrl,
  getLateFoodForArea,
} from "@/lib/lateFood";
import { MAP_EXPERIENCE_LENS_URL_PARAM, parseMapExperienceLensParam } from "@/lib/mapExperienceLens";

const SNAPSHOT_NOW = Date.parse("2026-11-21T23:00:00.000Z");

describe("lateFoodNearMapUrl", () => {
  it("opens the map food view around the last stop", () => {
    const href = lateFoodNearMapUrl("venue-s2ppfm");
    expect(href).toBe(
      `/map?sel=venue-s2ppfm&${MAP_EXPERIENCE_LENS_URL_PARAM}=food`,
    );
    expect(href).not.toMatch(/just-eat|deliveroo/i);
  });
});

describe("food ending handoff", () => {
  it("builds food ending selections from late-food terminals", () => {
    const terminal = getLateFoodForArea("piccadilly-soho", [], {
      now: SNAPSHOT_NOW,
    })[0]!;
    const selection = foodEndingSelection(terminal);
    expect(selection.kind).toBe("food");
    expect(selection.optionId).toBe(terminal.id);
    expect(selection.externalPlaceId).toBe(terminal.id);
    expect(selection.evidenceSnapshot.source).toContain(terminal.provenance.source);
    expect(selection.evidenceSnapshot.warnings).toContain(terminal.hours.service);
  });
});

describe("parseMapExperienceLensParam", () => {
  it("accepts food and no-alcohol deep links", () => {
    expect(parseMapExperienceLensParam("food")).toBe("food");
    expect(parseMapExperienceLensParam("no-alcohol")).toBe("no-alcohol");
    expect(parseMapExperienceLensParam("pint")).toBeNull();
  });
});
