import { describe, expect, it, vi } from "vitest";

import {
  palFindListedVenue,
  palLastNamedVenue,
  palMapAskTarget,
  palPubAskVenue,
} from "@/lib/palMapAsk";
import { palNextStop, palVoiceMapIntent } from "@/lib/palVoiceTranscript";
import { venueMapUrl } from "@/lib/venueMapUrl";

const VENUES = [
  { id: "venue-lyceum", name: "The Lyceum Tavern" },
  { id: "venue-lamb", name: "The Lamb" },
  { id: "venue-queens", name: "The Queen's Head" },
  { id: "venue-crown-1", name: "The Crown" },
  { id: "venue-crown-2", name: "The Crown" },
  { id: "venue-ship", name: "Ship" },
  { id: "venue-cork", name: "Cork & Bottle", sourceName: "Cork and Bottle Wine Bar" },
];

// Every line the Pal's map door reads as "one pub", spoken or typed, and what
// it names. `null` is a line that is not one, so it goes to the Pal (or, for a
// plain map ask, opens the map as before).
const TARGETS: Array<[string, ReturnType<typeof palMapAskTarget>]> = [
  ["take me there", { kind: "last" }],
  ["Can you take me there please?", { kind: "last" }],
  ["ok let's go there", { kind: "last" }],
  ["show me it", { kind: "last" }],
  ["show it on the map", { kind: "last" }],
  ["show me that one on the map", { kind: "last" }],
  ["show me on the map", { kind: "last" }],
  ["where's that?", { kind: "last" }],
  ["how do I get there", { kind: "last" }],
  ["take me to that pub", { kind: "last" }],
  ["Where is The Lyceum Tavern?", { kind: "named", name: "the lyceum tavern" }],
  ["where's the lamb", { kind: "named", name: "the lamb" }],
  ["show The Queen's Head on the map", { kind: "named", name: "the queen's head" }],
  ["find The Lamb", { kind: "named", name: "the lamb" }],
  ["could you find me the lamb pub please", { kind: "named", name: "the lamb pub" }],
  ["show me where the Lamb is", { kind: "named", name: "the lamb" }],
  ["take me to the Lyceum Tavern", { kind: "named", name: "the lyceum tavern" }],
  ["don't take me there", null],
  ["do not show me it", null],
  ["don't show me the map", null],
  ["where is the lamb? not yet though", null],
  ["show me the map", null],
  ["take me to the map", null],
  ["take me to the next pub", null],
  ["where's next", null],
  ["tell me about this pub", null],
  ["cheap pint in soho", null],
];

describe("palMapAskTarget", () => {
  it.each(TARGETS)("reads %j", (line, target) => {
    expect(palMapAskTarget(line)).toEqual(target);
  });

  it("answers \"pub\" through the shared decision, after a night's next stop", () => {
    expect(palVoiceMapIntent("take me there", false)).toBe("pub");
    expect(palVoiceMapIntent("Where is The Lamb?", true)).toBe("pub");
    expect(palVoiceMapIntent("show The Lamb on the map", false)).toBe("pub");
    expect(palVoiceMapIntent("show me the map", false)).toBe("map");
    expect(palVoiceMapIntent("don't take me there", false)).toBeNull();
    expect(palVoiceMapIntent("take me to the next pub", true)).toBe("next-stop");
    expect(palVoiceMapIntent("take me to the next pub", false)).toBeNull();
  });
});

describe("palFindListedVenue", () => {
  it("finds the one listed pub, with or without \"the\", an apostrophe or \"pub\"", () => {
    expect(palFindListedVenue("the lyceum tavern", VENUES)?.id).toBe("venue-lyceum");
    expect(palFindListedVenue("lamb", VENUES)?.id).toBe("venue-lamb");
    expect(palFindListedVenue("the lamb pub", VENUES)?.id).toBe("venue-lamb");
    expect(palFindListedVenue("the queens head", VENUES)?.id).toBe("venue-queens");
    expect(palFindListedVenue("cork and bottle wine bar", VENUES)?.id).toBe("venue-cork");
  });

  it("names nothing for a name several pubs share, or no listed pub", () => {
    expect(palFindListedVenue("the crown", VENUES)).toBeNull();
    expect(palFindListedVenue("a quiet pub", VENUES)).toBeNull();
  });
});

describe("palLastNamedVenue", () => {
  it("reads the newest Pal line that names a listed pub", () => {
    expect(
      palLastNamedVenue(["Try The Lamb.", "The Lyceum Tavern has a pint at £5.60."], VENUES)?.id,
    ).toBe("venue-lyceum");
    expect(palLastNamedVenue(["Try The Lamb.", "Have a good night."], VENUES)?.id).toBe("venue-lamb");
  });

  it("never opens an older pub in place of an ambiguous newer one, or a one-word name", () => {
    expect(palLastNamedVenue(["Try The Lamb.", "The Crown is quiet now."], VENUES)).toBeNull();
    expect(palLastNamedVenue(["Ship it to me."], VENUES)).toBeNull();
  });
});

describe("palPubAskVenue", () => {
  it("opens the pub the surface holds for \"there\" without loading the index", async () => {
    const loadVenues = vi.fn(async () => VENUES);
    const venue = await palPubAskVenue("take me there", {
      lastVenue: { id: "venue-x", name: "The X" },
      palLines: [],
      loadVenues,
    });
    expect(venue?.id).toBe("venue-x");
    expect(loadVenues).not.toHaveBeenCalled();
  });

  it("names nothing for \"there\" when the Pal has named nothing", async () => {
    const loadVenues = vi.fn(async () => VENUES);
    expect(await palPubAskVenue("take me there", { lastVenue: null, palLines: [], loadVenues })).toBeNull();
    expect(loadVenues).not.toHaveBeenCalled();
  });

  it("reads a name against the listed pubs, and a failed load names nothing", async () => {
    expect(
      (await palPubAskVenue("where is the lamb", { lastVenue: null, palLines: [], loadVenues: async () => VENUES }))?.id,
    ).toBe("venue-lamb");
    expect(
      await palPubAskVenue("where is the lamb", {
        lastVenue: null,
        palLines: [],
        loadVenues: async () => {
          throw new Error("offline");
        },
      }),
    ).toBeNull();
  });
});

describe("palNextStop city", () => {
  it("builds the stop's link like venueMapUrl, so a stop outside London opens its city", () => {
    const stops = [
      { venueId: "venue-a", venueName: "A" },
      { venueId: "venue-mcr-iy010v", venueName: "Manchester stop" },
    ];
    expect(palNextStop(stops, 0)?.href).toBe(venueMapUrl("venue-mcr-iy010v"));
    expect(palNextStop(stops, 0)?.href).toMatch(/^\/map\/manchester\?sel=/);
  });
});
