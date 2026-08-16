import { describe, expect, it } from "vitest";

import {
  DESK_MODE_KINDS,
  deskAnswerHeadline,
  deskCheckedCaption,
  deskEmptyLine,
  deskLoadFailedLine,
  deskHoursCaption,
  deskLaptopCaption,
  deskSeatDataLine,
  deskWifiCaption,
  isDeskEligible,
  laptopFromOsm,
  parseOsmOpeningHours,
  parseNearModeParam,
  rankDeskNearMe,
  resolveNearMode,
  wifiFromOsm,
  type DeskPoint,
} from "@/lib/nearDesk";
import { evaluateOpenState } from "@/lib/busyness";
import { sanitizeEvent } from "@/lib/analyticsEvents";
import type { VenueKind } from "@/lib/venues";

const here = { lat: 51.5136, lng: -0.1365 };

function desk(
  id: string,
  kind: VenueKind,
  dLat: number,
  dLng: number,
  extras: Partial<DeskPoint> = {},
): DeskPoint {
  return {
    id,
    name: extras.name ?? id,
    lat: here.lat + dLat,
    lng: here.lng + dLng,
    kind,
    wifi: extras.wifi ?? "unknown",
    laptop: extras.laptop ?? "unknown",
    openingHours: extras.openingHours ?? null,
    hoursRaw: extras.hoursRaw ?? null,
    address: extras.address ?? "",
  };
}

describe("resolveNearMode", () => {
  it("defaults to pint when nothing is set", () => {
    expect(resolveNearMode(null, null)).toBe("pint");
    expect(resolveNearMode("", "")).toBe("pint");
  });

  it("honours an explicit query param over a remembered mode", () => {
    expect(resolveNearMode("desk", "pint")).toBe("desk");
    expect(resolveNearMode("pint", "desk")).toBe("pint");
  });

  it("uses the remembered mode only when the param is absent", () => {
    expect(resolveNearMode(null, "desk")).toBe("desk");
    expect(resolveNearMode("garbage", "desk")).toBe("desk");
  });

  it("parses only the closed mode set from the query", () => {
    expect(parseNearModeParam("desk")).toBe("desk");
    expect(parseNearModeParam("pint")).toBe("pint");
    expect(parseNearModeParam("DESK")).toBe(null);
    expect(parseNearModeParam("work")).toBe(null);
  });
});

describe("desk amenity parsing", () => {
  it("reads OSM internet_access as yes, no, or unknown", () => {
    expect(wifiFromOsm("yes")).toBe("yes");
    expect(wifiFromOsm("wlan")).toBe("yes");
    expect(wifiFromOsm("wired")).toBe("yes");
    expect(wifiFromOsm("terminal")).toBe("yes");
    expect(wifiFromOsm("no")).toBe("no");
    expect(wifiFromOsm(null)).toBe("unknown");
    expect(wifiFromOsm("customers")).toBe("unknown");
    expect(wifiFromOsm("")).toBe("unknown");
  });

  it("reads laptop tags as allowed or not known, never a guessed no", () => {
    expect(laptopFromOsm("yes", null)).toBe("allowed");
    expect(laptopFromOsm(null, "yes")).toBe("allowed");
    expect(laptopFromOsm("no", null)).toBe("unknown");
    expect(laptopFromOsm(null, null)).toBe("unknown");
  });

  it("admits desk kinds and wifi pubs, and refuses a pub with no wifi tag", () => {
    expect(DESK_MODE_KINDS).toEqual(["cafe", "coworking", "library", "hotel_lounge"]);
    expect(isDeskEligible({ kind: "cafe", wifi: "unknown" })).toBe(true);
    expect(isDeskEligible({ kind: "coworking", wifi: "unknown" })).toBe(true);
    expect(isDeskEligible({ kind: "library", wifi: "unknown" })).toBe(true);
    expect(isDeskEligible({ kind: "hotel_lounge", wifi: "unknown" })).toBe(true);
    expect(isDeskEligible({ kind: "pub", wifi: "yes" })).toBe(true);
    expect(isDeskEligible({ kind: "pub", wifi: "no" })).toBe(false);
    expect(isDeskEligible({ kind: "pub", wifi: "unknown" })).toBe(false);
    expect(isDeskEligible({ kind: "bar", wifi: "yes" })).toBe(false);
  });
});

describe("parseOsmOpeningHours", () => {
  it("parses 24/7 as every day open", () => {
    const hours = parseOsmOpeningHours("24/7");
    expect(hours).not.toBeNull();
    expect(evaluateOpenState({
      now: new Date("2026-08-16T12:00:00.000Z"),
      timeZone: "Europe/London",
      openingHours: hours ?? undefined,
    })).toBe(true);
  });

  it("parses weekday ranges and weekend lists", () => {
    const hours = parseOsmOpeningHours("Mo-Fr 08:00-16:00; Sa, Su 09:00-16:00");
    expect(hours).not.toBeNull();
    expect(evaluateOpenState({
      now: new Date("2026-08-17T10:00:00.000Z"),
      timeZone: "Europe/London",
      openingHours: hours ?? undefined,
    })).toBe(true);
    expect(evaluateOpenState({
      now: new Date("2026-08-17T06:30:00.000Z"),
      timeZone: "Europe/London",
      openingHours: hours ?? undefined,
    })).toBe(false);
    expect(evaluateOpenState({
      now: new Date("2026-08-16T10:30:00.000Z"),
      timeZone: "Europe/London",
      openingHours: hours ?? undefined,
    })).toBe(true);
  });

  it("parses comma-separated day rules", () => {
    const hours = parseOsmOpeningHours("Mo-Fr 08:00-17:00, Sa 08:30-17:00, Su 10:00-16:00");
    expect(hours?.[0]?.[0]).toEqual({ opens: "10:00", closes: "16:00" });
    expect(hours?.[6]?.[0]).toEqual({ opens: "08:30", closes: "17:00" });
  });

  it("treats an unreadable string as unknown rather than inventing a window", () => {
    expect(parseOsmOpeningHours("open until late")).toBeNull();
    expect(parseOsmOpeningHours("")).toBeNull();
    expect(parseOsmOpeningHours(null)).toBeNull();
  });
});

describe("rankDeskNearMe", () => {
  it("returns a thin answer when nothing eligible is in range", () => {
    const answer = rankDeskNearMe(here.lat, here.lng, [
      desk("bar", "bar", 0, 0.001),
      desk("pub", "pub", 0, 0.001, { wifi: "unknown" }),
    ]);
    expect(answer.scope).toBe("none");
    expect(answer.cards).toEqual([]);
    expect(answer.hero).toBeNull();
  });

  it("ranks first by distance, then known wifi, then laptop, then open now", () => {
    const closedHours = parseOsmOpeningHours("Mo-Fr 08:00-09:00");
    const openHours = parseOsmOpeningHours("Mo-Su 00:00-24:00");
    const now = new Date("2026-08-17T12:00:00.000Z");
    const venues: DeskPoint[] = [
      desk("far-wifi", "cafe", 0.008, 0, { wifi: "yes", name: "Far Wifi" }),
      desk("near-unknown", "cafe", 0.001, 0, { name: "Near Unknown" }),
      desk("near-wifi", "cafe", 0.001, 0.0001, { wifi: "yes", name: "Near Wifi" }),
      desk("near-wifi-laptop", "cafe", 0.001, 0.0002, {
        wifi: "yes",
        laptop: "allowed",
        name: "Near Wifi Laptop",
      }),
      desk("near-wifi-laptop-open", "cafe", 0.001, 0.0003, {
        wifi: "yes",
        laptop: "allowed",
        openingHours: openHours,
        name: "Near Open",
      }),
      desk("near-wifi-laptop-closed", "cafe", 0.001, 0.0004, {
        wifi: "yes",
        laptop: "allowed",
        openingHours: closedHours,
        name: "Near Closed",
      }),
    ];
    const answer = rankDeskNearMe(here.lat, here.lng, venues, { now });
    expect(answer.scope).toBe("walkable");
    expect(answer.hero?.name).toBe("Near Open");
    expect(answer.cards.map((card) => card.name)).toEqual([
      "Near Open",
      "Near Wifi Laptop",
      "Near Closed",
      "Near Wifi",
      "Far Wifi",
    ]);
    expect(answer.cards.every((card) => card.wifiCaption && card.laptopCaption)).toBe(true);
    expect(answer.cards[0]?.openNow).toBe(true);
    expect(answer.cards.find((card) => card.name === "Near Closed")?.openNow).toBe(false);
  });

  it("widens honestly when the walkable ring is thin", () => {
    const answer = rankDeskNearMe(here.lat, here.lng, [
      desk("far", "library", 0.02, 0, { name: "Far Library" }),
    ]);
    expect(answer.scope).toBe("widened");
    expect(answer.hero?.name).toBe("Far Library");
    expect(answer.cards).toHaveLength(1);
  });

  it("includes a wifi pub and names it as a pub with wifi", () => {
    const answer = rankDeskNearMe(here.lat, here.lng, [
      desk("spoons", "pub", 0.001, 0, { wifi: "yes", name: "The Spoons" }),
    ]);
    expect(answer.hero?.kindLabel).toBe("Pub with wifi");
    expect(answer.hero?.wifi).toBe("yes");
  });

  it("prints honest amenity and hours copy on every card", () => {
    const hours = parseOsmOpeningHours("Mo-Fr 08:00-17:00");
    const answer = rankDeskNearMe(here.lat, here.lng, [
      desk("bean", "cafe", 0.001, 0, {
        name: "Desk and Bean",
        wifi: "yes",
        laptop: "allowed",
        openingHours: hours,
        hoursRaw: "Mo-Fr 08:00-17:00",
      }),
    ], { observedAt: "2026-08-16T04:01:27.583Z" });
    const card = answer.hero;
    expect(card?.wifiCaption).toBe("Wifi: yes");
    expect(card?.laptopCaption).toBe("Laptops: allowed");
    expect(card?.hoursCaption).toBe("Hours: Mo-Fr 08:00-17:00");
    expect(card?.seatDataLine).toBe("No seat data yet");
    expect(card?.source).toBe("osm");
    expect(card?.checkedCaption).toMatch(/^Checked /);
  });
});

describe("desk copy", () => {
  it("keeps empty and amenity lines in house voice", () => {
    expect(deskEmptyLine()).toBe("No desks logged near here yet - add a spot");
    expect(deskSeatDataLine()).toBe("No seat data yet");
    expect(deskWifiCaption("yes")).toBe("Wifi: yes");
    expect(deskWifiCaption("no")).toBe("Wifi: no");
    expect(deskWifiCaption("unknown")).toBe("Wifi: unknown");
    expect(deskLaptopCaption("allowed")).toBe("Laptops: allowed");
    expect(deskLaptopCaption("unknown")).toBe("Laptops: not known");
    expect(deskHoursCaption("Mo-Fr 08:00-17:00")).toBe("Hours: Mo-Fr 08:00-17:00");
    expect(deskHoursCaption(null)).toBe("Hours: unknown");
    expect(deskCheckedCaption("2026-08-16T04:01:27.583Z")).toBe("Checked 16 Aug");
    expect(deskCheckedCaption(null)).toBe("No date on this yet");
    expect(deskAnswerHeadline({ scope: "walkable" })).toBe("Somewhere to sit near you");
    expect(deskAnswerHeadline({ scope: "widened" })).toBe("Nearest desks a bit further out");
    expect(deskAnswerHeadline({ scope: "none", patchLabel: "Soho" })).toBe(
      "No desks logged around Soho yet",
    );
    expect(deskLoadFailedLine()).toBe("Could not check desks near here.");
    for (const line of [
      deskEmptyLine(),
      deskSeatDataLine(),
      deskAnswerHeadline({ scope: "walkable" }),
    ]) {
      expect(line).not.toMatch(/[\u2014\u2013]/);
      expect(line).not.toMatch(/!/);
    }
  });
});

describe("desk analytics", () => {
  it("accepts closed mode and outcome props and drops coordinates", () => {
    expect(sanitizeEvent("near_mode_switched", {
      mode: "desk",
      latitude: 51.5,
      handle: "karan",
    })).toEqual({
      name: "near_mode_switched",
      props: { mode: "desk" },
    });
    expect(sanitizeEvent("desk_answer_served", {
      outcome: "thin",
      venueId: "venue-osm-n1",
    })).toEqual({
      name: "desk_answer_served",
      props: { outcome: "thin" },
    });
    expect(sanitizeEvent("near_mode_switched", { mode: "work" })).toBeNull();
    expect(sanitizeEvent("desk_answer_served", { outcome: "busy" })).toBeNull();
  });
});
