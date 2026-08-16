import { readFileSync } from "node:fs";
import path from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SourceCredit } from "@/components/out/SourceCredit";
import { mergeCommunityPriceSignals } from "@/components/map/communityPriceSignals";
import { OUT_CARD_SOURCES, outCardSource, outSourceAttribution } from "@/lib/out/attribution";
import type { WhatsOnRow } from "@/lib/whatsOn";

const ROOT = path.join(__dirname, "..");

function eventRow(overrides: Partial<WhatsOnRow> = {}): WhatsOnRow {
  return {
    id: "events-sk-1",
    placeName: "A Basement",
    kind: "event",
    startsAt: "2026-08-16T21:00:00.000Z",
    title: "Warehouse Night",
    priceGbp: 12,
    source: { label: "Skiddle", url: "https://www.skiddle.com/whats-on/e/1" },
    observedAt: "2026-08-16T09:00:00.000Z",
    confidence: "listed",
    sourceId: "1",
    ...overrides,
  };
}

describe("Skiddle name and logo credit", () => {
  it("requires a logo whenever a Skiddle row is in the answer", () => {
    const attribution = outSourceAttribution([eventRow()]);
    expect(attribution).toEqual([
      {
        label: "Skiddle",
        logoRequired: true,
        url: "https://www.skiddle.com/",
      },
    ]);
  });

  it("renders the Skiddle name and logo whenever a Skiddle row is on screen", () => {
    const html = renderToStaticMarkup(
      SourceCredit({ source: eventRow().source }),
    );
    expect(html).toMatch(/Skiddle/);
    expect(html).toMatch(/<img|svg/i);
    expect(html).toMatch(/skiddle/i);
    expect(html).toMatch(/https:\/\/www\.skiddle\.com\/whats-on\/e\/1/);
  });

  it("does not require the Skiddle logo for a Ticketmaster-only list", () => {
    const attribution = outSourceAttribution([
      eventRow({
        source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/1" },
      }),
    ]);
    expect(attribution.some((item) => item.label === "Skiddle")).toBe(false);
    expect(attribution[0]).toMatchObject({ label: "Ticketmaster", logoRequired: false });
  });
});

describe("event ticket price stays off price lanes", () => {
  it("never feeds a kind=event priceGbp into mergeCommunityPriceSignals", () => {
    const mergeSource = readFileSync(
      path.join(ROOT, "components/map/communityPriceSignals.ts"),
      "utf8",
    );
    const communitySource = readFileSync(path.join(ROOT, "lib/communityPrice.ts"), "utf8");
    expect(mergeSource).not.toMatch(/WhatsOnRow/);
    expect(mergeSource).not.toMatch(/kind\s*===\s*["']event["']/);
    expect(communitySource).not.toMatch(/WhatsOnRow/);
    const signals = new Map();
    const prices = new Map();
    expect(mergeCommunityPriceSignals(signals, prices)).toBe(signals);
  });

  it("keeps landing price honesty off the event ticket lane", () => {
    const landing = readFileSync(
      path.join(ROOT, "components/landing/LandingPage.tsx"),
      "utf8",
    );
    expect(landing.toLowerCase()).not.toContain("from £");
    expect(landing).not.toMatch(/kind:\s*["']event["']/);
  });

  it("names the closed card-source set without ids or coords", () => {
    expect(OUT_CARD_SOURCES).toEqual(["ticketmaster", "skiddle", "common", "venue"]);
    expect(outCardSource("Skiddle")).toBe("skiddle");
    expect(outCardSource("Ticketmaster")).toBe("ticketmaster");
    expect(outCardSource("common")).toBe("common");
    expect(outCardSource("The Hope")).toBe("venue");
  });
});
