import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

import LandingHero from "@/components/landing/LandingHero";
import { buildLandingArchiveIndex, buildLandingPubCard } from "@/lib/landingPubCard";
import type { Venue } from "@/lib/venues";

// Two true dated prices are not a trend unless they are the same thing bought.
// The card's figure today is a listed Bud Light; an archive pint that names a
// different drink, or names none, is still a fact about the past and keeps its
// figure, month, source and day. What it cannot carry is a sentence saying this
// pub's pint went up or down: that compares two items nobody has shown match.

const NOW = Date.UTC(2026, 9, 17, 12);
const VENUE_ID = "venue-budlight";

function venue(): Venue {
  return {
    id: VENUE_ID,
    name: "The Comparison Arms",
    address: "1 Test Street",
    latitude: 51.5,
    longitude: -0.1,
    primaryBorough: "City of London",
    visibleBoroughs: ["City of London"],
    prices: [
      {
        app_price_id: VENUE_ID,
        pub_name: "The Comparison Arms",
        pint_name: "BUD LIGHT",
        price_gbp: 4.14,
        price_text: "£4.14",
        address: "1 Test Street",
        latitude: 51.5,
        longitude: -0.1,
        boroughs_visible: "City of London",
        boroughs_raw_embedded_non_anomaly: "",
        boroughs_raw_embedded_site_anomaly: "",
        primary_borough: "City of London",
        rank_visible_borough: "",
        estimated_average_price_text: "",
        pub_url: "https://www.pint-prices.com/pub/x",
        scraped_at_values: "2026-09-20T11:15:56+00:00",
        constructed_pub_url: "",
        borough_urls: "",
        phone_number: "",
        email: "",
        website: "",
        booking_link: "",
        image_url: "",
        description: "",
        comment: "",
        food: "",
        cocktails: "",
        beer_garden: "",
        live_sports: "",
        live_music: "",
        pub_quiz: "",
        darts: "",
        pool: "",
        happy_hour: "",
        karaoke: "",
        cool: "",
        source_datasets: "test",
        source_row_count: 1,
        has_visible_borough_row: true,
        has_raw_embedded_map_row: false,
        has_individual_pub_page_row: false,
      } as Venue["prices"][number],
    ],
    cheapestPrice: 4.14,
    cheapestPint: "BUD LIGHT",
    averagePrice: 4.14,
    hasStory: false,
    latestContributorPrice: null,
    latestContributorAt: null,
    amenities: {
      food: false, cocktails: false, beerGarden: false, liveSports: false, liveMusic: false,
      pubQuiz: false, darts: false, pool: false, happyHour: false, karaoke: false, nonAlcoholic: false,
    },
    website: "",
    bookingLink: "",
  } as Venue;
}

function history(drink: string | undefined) {
  return {
    version: 1,
    generatedAt: "2026-07-27",
    observations: [
      {
        venueId: VENUE_ID,
        venueName: "The Comparison Arms",
        priceGbp: 4.6,
        observedOn: "2013-07-14",
        ...(drink === undefined ? {} : { drink }),
        source: {
          label: "beerintheevening.com",
          url: "https://www.beerintheevening.com/pubs/x",
          licence: "quoted with attribution",
        },
      },
    ],
  };
}

const MOVEMENT = /\b(?:Up|Down) £\d|\bSame price\b/;

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

describe("a then line with no matched item claims no movement", () => {
  it.each([
    ["names a different drink", "a pint of London Pride"],
    ["names no drink at all", undefined],
  ])("when the archive pint %s", (_label, drink) => {
    const venues = [venue()];
    const raw = history(drink);
    const card = buildLandingPubCard(venues, raw, { now: NOW });
    const archive = buildLandingArchiveIndex(venues, raw, NOW);

    // Both facts survive: today's listed figure and the dated, sourced archive row.
    expect(card).not.toBeNull();
    expect(card?.priceGbp).toBe(4.14);
    expect(card?.then).toEqual({
      priceGbp: 4.6,
      observedOn: "2013-07-14",
      source: { label: "beerintheevening.com", url: "https://www.beerintheevening.com/pubs/x" },
    });
    // No field of the card carries a movement sentence between unmatched items.
    expect(strings(card).filter((text) => MOVEMENT.test(text))).toEqual([]);

    const html = renderToStaticMarkup(
      createElement(LandingHero, { card, archive, rail: [] }),
    );
    // The current figure is today's, never the archive's.
    expect(html).toMatch(/priceBadge--current[^"]*"[^>]*>£4\.14</);
    // The historical fact still prints with its month, source and day.
    expect(html).toContain("<strong>£4.60</strong> in July 2013.");
    expect(html).toMatch(/<a href="https:\/\/www\.beerintheevening\.com\/pubs\/x"[^>]*>beerintheevening\.com<\/a>, 14 July 2013/);
    // And the rendered card says nothing about the pint going up or down.
    const words = html.replace(/<[^>]+>/g, " ");
    expect(words).not.toMatch(MOVEMENT);
  });
});
