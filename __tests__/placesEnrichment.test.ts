import { applyPlacesEnrichment } from "@/lib/venuePlacesEnrichment";
import { expect, it } from "vitest";
import { placesEnrichmentRecord, placesOpeningHours, planPlacesEnrichment } from "@/lib/placesEnrichment";
import { slimVenueToPin } from "@/lib/slimPins";
import { defined } from "@/__tests__/helpers/defined";

const now = new Date("2026-10-04T12:00:00Z");
const base = () => slimVenueToPin({ id: "venue-osm-n1", name: "Test Arms", lat: 51.5, lng: -0.1, borough: "Camden", cheapestPrice: null });

it("publishes copied contacts, address and regular hours with each field's own source and day", () => {
  const record = placesEnrichmentRecord("venue-osm-n1", "ChIJVerified123", {
    formattedAddress: "1 High Street, London",
    nationalPhoneNumber: "020 7946 0123",
    websiteUri: "https://pub.example/",
    regularOpeningHours: { periods: [{ open: { day: 0, hour: 12, minute: 0 }, close: { day: 0, hour: 23, minute: 0 } }], weekdayDescriptions: ["Sunday: 12:00–23:00"] },
  }, "2026-10-04T09:00:00Z");
  const venue = applyPlacesEnrichment(base(), record, now);
  expect(venue.address).toBe("1 High Street, London");
  expect(venue.website).toBe("https://pub.example/");
  expect(venue.contacts?.phoneHref).toBe("tel:02079460123");
  expect(venue.openingHours?.[0]).toEqual([{ opens: "12:00", closes: "23:00" }]);
  expect(venue.placesContent?.formattedAddress).toEqual({ value: "1 High Street, London", source: "google_places", observedAt: "2026-10-04T09:00:00Z" });
});

it("keeps each copied field under its own date past 30 days, lets only fresh hours set open state, and refuses unsafe contacts", () => {
  const record = placesEnrichmentRecord("venue-osm-n1", "ChIJVerified123", {
    formattedAddress: "New address", websiteUri: "javascript:alert(1)", nationalPhoneNumber: "visit example.com",
    regularOpeningHours: { periods: [{ open: { day: 0, hour: 12, minute: 0 }, close: { day: 0, hour: 23, minute: 0 } }] },
  }, "2026-10-04T09:00:00Z");
  record.regularOpeningHours!.observedAt = "2026-08-01T09:00:00Z";
  const venue = applyPlacesEnrichment(base(), record, now);
  expect(venue.address).toBe("New address");
  expect(venue.website).toBe(base().website);
  expect(venue.contacts?.phoneHref).toBeNull();
  expect(venue.openingHours).toBeUndefined();
  expect(placesOpeningHours(venue.placesContent, now)?.[0]).toEqual([{ opens: "12:00", closes: "23:00" }]);
  expect(venue.placesContent?.regularOpeningHours?.observedAt).toBe("2026-08-01T09:00:00Z");
  expect(applyPlacesEnrichment(base(), record, new Date("2026-12-01T00:00:00Z")).address).toBe("New address");
});

it("keeps missing and invalid hours unknown, including future-dated hours", () => {
  const invalid = placesEnrichmentRecord("venue-osm-n1", "ChIJVerified123", {
    regularOpeningHours: { periods: [{ open: { day: 0, hour: 12, minute: 0 } }] },
  }, "2026-10-04T09:00:00Z");
  expect(invalid.regularOpeningHours).toBeUndefined();
  const future = placesEnrichmentRecord("venue-osm-n1", "ChIJVerified123", {
    regularOpeningHours: { periods: [{ open: { day: 0, hour: 0, minute: 0 } }] },
  }, "2026-11-04T09:00:00Z");
  expect(applyPlacesEnrichment(base(), future, now).openingHours).toBeUndefined();
});

it("prioritises incomparable and mismatched verified pubs, refusing unverified report ids and budget overruns", () => {
  const verified = ["1", "2", "3"].map((n) => ({ venueId: `venue-osm-n${n}`, googlePlaceId: `ChIJVerified00${n}` }));
  const report = [
    { ...defined(verified[1]), verdict: "mismatch" },
    { ...defined(verified[2]), verdict: "unknown" },
    { venueId: "venue-osm-n4", googlePlaceId: "ChIJNotVerified", verdict: "unknown" },
  ];
  const plan = planPlacesEnrichment(verified, report, 0.03, 0);
  expect(plan.rows.map((row) => row.venueId)).toEqual(["venue-osm-n3"]);
  expect(plan.projectedUsd).toBe(0.02);
  expect(plan.omittedForBudget).toBe(2);
  expect(planPlacesEnrichment(verified, report, 0.03, 0.02).rows).toEqual([]);
});

it("copies validated Google extras with their own source and observation date, preserving explicit false", () => {
  const at = "2026-10-04T12:00:00Z";
  const row = placesEnrichmentRecord("venue-uk-n1", "ChIJVerified0001", {
    rating: 4.3, userRatingCount: 128, priceLevel: "PRICE_LEVEL_MODERATE",
    editorialSummary: { text: "A neighbourhood pub.", languageCode: "en" },
    outdoorSeating: false, servesBeer: true, servesWine: true, servesCocktails: true,
    goodForGroups: true, liveMusic: false, allowsDogs: true, goodForWatchingSports: true, servesLunch: false, reservable: true,
    accessibilityOptions: { wheelchairAccessibleEntrance: true, wheelchairAccessibleRestroom: false, unknown: true },
    paymentOptions: { acceptsNfc: true, acceptsCashOnly: false, acceptsCrypto: true },
  }, at);
  expect(row.rating).toEqual({ value: 4.3, source: "google_places", observedAt: at });
  expect(row.outdoorSeating?.value).toBe(false);
  expect(row.editorialSummary?.value).toEqual({ text: "A neighbourhood pub.", languageCode: "en" });
  expect(row.accessibilityOptions?.value).toEqual({ wheelchairAccessibleEntrance: true, wheelchairAccessibleRestroom: false });
  expect([row.allowsDogs?.value, row.goodForWatchingSports?.value, row.servesLunch?.value, row.reservable?.value]).toEqual([true, true, false, true]);
  expect(row.paymentOptions).toEqual({ value: { acceptsNfc: true, acceptsCashOnly: false }, source: "google_places", observedAt: at });
  const invalid = placesEnrichmentRecord("venue-uk-n1", "ChIJVerified0001", {
    rating: 9, userRatingCount: -1, priceLevel: "cheap", outdoorSeating: "yes", allowsDogs: "yes", editorialSummary: { text: "" },
    paymentOptions: { acceptsNfc: "yes" },
  }, at);
  expect(Object.keys(invalid)).toEqual(["venueId", "googlePlaceId", "observedAt"]);
});
