import {
  OUT_LISTING_PUB_ABSENT_LINE,
  OUT_OPEN_PLANS_MIN_SENDABLE,
  groupOutListings,
  outListingGroupKey,
  outListingPubPair,
  outListingUnmatchedCount,
  outOpenPlansSectionVisible,
  sendableOpenPlans,
} from "@/lib/outDesktopGrouping";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OutListingPubPair } from "@/components/out/OutListingPubPair";
import type { OutOpenPlan } from "@/lib/out";
import { describe, expect, it } from "vitest";
import type { WhatsOnRow } from "@/lib/whatsOn";

function row(partial: Partial<WhatsOnRow> & Pick<WhatsOnRow, "id" | "kind" | "title">): WhatsOnRow {
  return {
    placeName: "The Test Arms",
    source: { label: "Ticketmaster", url: "https://example.com/event/1" },
    observedAt: "2026-08-14T12:00:00.000Z",
    confidence: "listed",
    ...partial,
  };
}

function openPlan(partial: Partial<OutOpenPlan> & Pick<OutOpenPlan, "crewId" | "title">): OutOpenPlan {
  return {
    startTime: "2026-08-16T19:00:00.000Z",
    stopVenueId: "venue-1",
    stopVenueName: "The Anchor",
    hostHandle: "karan",
    memberCount: 2,
    meetingPoint: {
      kind: "venue",
      name: "The Anchor",
      lat: 51.5,
      lng: -0.1,
    },
    ...partial,
  };
}

describe("out desktop grouping", () => {
  it("groups by venue id before area or place name", () => {
    const venueA = row({
      id: "gig-a",
      kind: "music",
      title: "Early set",
      venueId: "venue-soho",
      placeName: "Soho Theatre",
      startsAt: "2026-08-16T19:00:00.000Z",
    });
    const venueB = row({
      id: "gig-b",
      kind: "music",
      title: "Late set",
      venueId: "venue-soho",
      placeName: "Soho Theatre",
      startsAt: "2026-08-16T22:00:00.000Z",
    });
    const areaOnly = row({
      id: "quiz-1",
      kind: "quiz",
      title: "Pub quiz",
      area: "camden",
      placeName: "The Camden Head",
      startsAt: "2026-08-16T20:00:00.000Z",
    });

    const groups = groupOutListings([areaOnly, venueB, venueA]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.key).toBe("venue:venue-soho");
    expect(groups[0]?.rows.map((item) => item.id)).toEqual(["gig-a", "gig-b"]);
    expect(groups[1]?.key).toBe("area:camden");
    expect(outListingGroupKey(venueA).kind).toBe("venue");
    expect(outListingGroupKey(areaOnly).kind).toBe("area");
  });

  it("pairs a resolved pub beside a gig and names honest absence without one", () => {
    const matched = row({
      id: "matched",
      kind: "event",
      title: "Comedy",
      venueId: "venue-123",
      placeName: "The Comedy Store",
    });
    const absent = row({
      id: "absent",
      kind: "event",
      title: "Arena show",
      placeName: "The O2",
    });

    expect(outListingPubPair(matched)).toEqual({
      status: "matched",
      placeName: "The Comedy Store",
      mapHref: "/map?sel=venue-123",
    });
    expect(outListingPubPair(absent)).toEqual({
      status: "absent",
      line: OUT_LISTING_PUB_ABSENT_LINE,
    });
  });

  it("counts unmatched events once for the page-level state", () => {
    const matched = row({
      id: "matched-count",
      kind: "event",
      title: "Comedy",
      venueId: "venue-123",
    });
    const absent = row({ id: "absent-count", kind: "event", title: "Arena show" });

    expect(outListingUnmatchedCount([matched, absent, absent])).toBe(2);
  });

  it("keeps unmatched row status visible and available to assistive technology", () => {
    const html = renderToStaticMarkup(
      createElement(OutListingPubPair, {
        row: row({ id: "absent-render", kind: "event", title: "Arena show" }),
      }),
    );

    expect(html).toContain('class="outListingPubPair outListingPubPair--absent"');
    expect(html).toContain(OUT_LISTING_PUB_ABSENT_LINE);
  });

  it("keeps desktop listing columns balanced inside a centred surface", () => {
    const css = readFileSync(join(process.cwd(), "app/out/out.css"), "utf8");
    const desktop = css.match(/@media \(min-width: 1024px\) \{([\s\S]*)/)?.[1] ?? "";
    expect(desktop).toMatch(
      /\.outListingSurface\s*\{[^}]*max-width:\s*1120px;[^}]*margin-inline:\s*auto;/,
    );
  });

  it("hides Open plans until at least three sendable plans exist", () => {
    const sendable = openPlan({ crewId: "crew-1", title: "Soft plan" });
    const unsendable = openPlan({
      crewId: "crew-2",
      title: "No meet point",
      meetingPoint: null,
    });

    expect(OUT_OPEN_PLANS_MIN_SENDABLE).toBe(3);
    expect(sendableOpenPlans([sendable, unsendable, sendable, sendable])).toHaveLength(3);
    expect(outOpenPlansSectionVisible([sendable, unsendable])).toBe(false);
    expect(
      outOpenPlansSectionVisible([
        sendable,
        openPlan({ crewId: "crew-3", title: "Third" }),
        openPlan({ crewId: "crew-4", title: "Fourth" }),
      ]),
    ).toBe(true);
  });
});
