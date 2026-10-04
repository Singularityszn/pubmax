// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import VenuePlacesDetails from "@/components/map/VenuePlacesDetails";
import { placesEnrichmentRecord } from "@/lib/placesEnrichment";
import { slimVenueToPin } from "@/lib/slimPins";
import { applyPlacesEnrichment } from "@/lib/venuePlacesEnrichment";
import { venueContactContract } from "@/lib/venueTruth";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("credits copied address, phone, website and old hours with the day Google Places was checked", () => {
  const record = placesEnrichmentRecord("venue-osm-n1", "ChIJVerified123", {
    formattedAddress: "1 High Street, London",
    nationalPhoneNumber: "020 7946 0123",
    websiteUri: "https://pub.example/",
    regularOpeningHours: { periods: [{ open: { day: 0, hour: 12, minute: 0 }, close: { day: 0, hour: 23, minute: 0 } }] },
  }, "2025-01-05T09:00:00Z");
  const venue = applyPlacesEnrichment(
    slimVenueToPin({ id: "venue-osm-n1", name: "Test Arms", lat: 51.5, lng: -0.1, borough: "Camden", cheapestPrice: null }),
    record,
  );
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(createElement(VenuePlacesDetails, { venue, links: true, websiteLink: true })));
  expect(venue.openingHours).toBeUndefined();
  expect(container.querySelector(".venuePlacesDetailsCredit")?.textContent).toBe("Address, phone and website: Google Places · Checked 5 Jan 2025");
  expect([...container.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual(["tel:02079460123", "https://pub.example/"]);
  expect(container.querySelector("details small")?.textContent).toBe("Google Places · Checked 5 Jan 2025");
  expect(container.querySelector("dd")?.textContent).toBe("Closed");
  act(() => root.unmount());
});

it("renders no panel or call link for a venue without Google Places content", () => {
  const venue = {
    ...slimVenueToPin({ id: "venue-osm-n2", name: "Dataset Arms", lat: 51.5, lng: -0.1, borough: "Camden", cheapestPrice: null }),
    contacts: venueContactContract({ phone: "020 7946 0456", website: "https://dataset.example/" }),
  };
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(createElement(VenuePlacesDetails, { venue, links: true, websiteLink: true })));
  expect(container.innerHTML).toBe("");
  act(() => root.unmount());
});

it("shows Google rating, venue price level and stated amenities with per-field dates without inventing a pint price", () => {
  const record = placesEnrichmentRecord("venue-uk-n1", "ChIJVerified123", {
    rating: 4.3, userRatingCount: 128, priceLevel: "PRICE_LEVEL_MODERATE",
    servesCocktails: true, outdoorSeating: false, liveMusic: true, goodForGroups: false,
    allowsDogs: true, goodForWatchingSports: true, servesDinner: false, menuForChildren: true,
    accessibilityOptions: { wheelchairAccessibleEntrance: true },
    paymentOptions: { acceptsNfc: true, acceptsCreditCards: true, acceptsCashOnly: false },
    editorialSummary: { text: "A neighbourhood pub.", languageCode: "en" },
  }, "2025-02-02T09:00:00Z");
  record.userRatingCount!.observedAt = "2025-02-03T09:00:00Z";
  const venue = applyPlacesEnrichment(slimVenueToPin({ id: "venue-uk-n1", name: "Test Arms", lat: 53.5, lng: -2.1, borough: "Manchester", cheapestPrice: null }), record);
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(createElement(VenuePlacesDetails, { venue })));
  expect(container.textContent).toContain("4.3 / 5");
  expect(container.textContent).toContain("128 ratings");
  expect(container.textContent).toContain("Price level: ££");
  expect(container.textContent).toContain("Checked 2 Feb 2025");
  expect(container.textContent).toContain("Checked 3 Feb 2025");
  expect(container.textContent).toContain("Cocktails");
  expect(container.textContent).toContain("Live music");
  expect(container.textContent).toContain("Step-free entry");
  const amenities = [...container.querySelectorAll('[aria-label="Google Places amenities"] .amenity')].map((chip) => chip.textContent);
  expect(amenities).toEqual(["No outdoor seating", "Cocktails", "No room for groups", "Live music", "Live sport", "Dogs allowed", "No dinner", "Children's menu"]);
  const payment = [...container.querySelectorAll('[aria-label="Google Places payment"] .accessibilityChip')].map((chip) => chip.textContent);
  expect(payment).toEqual(["Credit cards", "Contactless"]);
  expect(container.textContent).not.toContain("Beer garden");
  expect(container.textContent).toContain("A neighbourhood pub.");
  expect(venue.cheapestPrice).toBeNull();
  act(() => root.unmount());
});
