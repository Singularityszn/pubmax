import { describe, expect, it } from "vitest";

import { getNightAreasForCity } from "@/lib/nightAreas";
import { palAreaNamed, palMapToolAction } from "@/lib/palMapClientToolCall";
import { PAL_MAP_CLIENT_TOOL_NAMES } from "@/lib/palMapClientTools.mjs";
import type { PalMapPick } from "@/lib/palMapCommands";

const picks: PalMapPick[] = [1, 2, 3].map((number) => ({ venueId: `v${number}`, name: `Pub ${number}`, lat: 51.5, lng: -0.1, number }));
const london = getNightAreasForCity("london");

describe("voice map client tool calls", () => {
  it("answers every tool the agent is given", () => {
    for (const tool of PAL_MAP_CLIENT_TOOL_NAMES) {
      const action = palMapToolAction(tool, { number: 1, area: "Soho" }, { picks, areas: london });
      expect(action.kind, tool).not.toBe("refused");
    }
    expect(palMapToolAction("map_delete_pub", {}, { picks })).toMatchObject({ kind: "refused" });
  });

  it("takes a pick by its number on the map, written as a number or a digit string", () => {
    expect(palMapToolAction("map_focus_pick", { number: 2 }, { picks })).toEqual({ kind: "focusPick", pick: picks[1] });
    expect(palMapToolAction("map_open_pick_sheet", { number: "3" }, { picks })).toEqual({ kind: "openPickSheet", pick: picks[2] });
  });

  it("refuses a pick that is not on the map and says what is", () => {
    expect(palMapToolAction("map_focus_pick", { number: 5 }, { picks })).toEqual({
      kind: "refused", update: "The map could not show pick 5. 3 picks are on the map.",
    });
    expect(palMapToolAction("map_open_pick_sheet", { number: 1 }, { picks: [] })).toEqual({
      kind: "refused", update: "The map could not show pick 1. No picks are on the map yet.",
    });
    for (const number of [0, 7, 2.5, "two", null, undefined]) {
      expect(palMapToolAction("map_focus_pick", { number }, { picks })).toEqual({
        kind: "refused", update: "The map could not show that pick. 3 picks are on the map.",
      });
    }
  });

  it("finds a London area by its name, slug or a local name, and refuses any other", () => {
    expect(palAreaNamed("Soho", london)?.slug).toBe("piccadilly-soho");
    expect(palAreaNamed("kings cross", london)?.slug).toBe("kings-cross");
    expect(palAreaNamed("King’s Cross", london)?.slug).toBe("kings-cross");
    expect(palAreaNamed("Bermondsey & London Bridge", london)?.slug).toBe("bermondsey-london-bridge");
    expect(palAreaNamed("canary-wharf", london)?.slug).toBe("canary-wharf");
    expect(palMapToolAction("map_fly_to_area", { area: "Peckham" }, { picks, areas: london }))
      .toMatchObject({ kind: "flyToArea", area: { slug: "peckham" } });
    for (const area of ["Atlantis", "", "Manchester city centre", 42]) {
      expect(palMapToolAction("map_fly_to_area", { area }, { picks, areas: london })).toMatchObject({ kind: "refused" });
    }
  });
});
