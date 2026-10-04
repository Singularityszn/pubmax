// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import VenuePlacesDetails from "@/components/map/VenuePlacesDetails";
import { placesEnrichmentRecord } from "@/lib/placesEnrichment";
import { slimVenueToPin } from "@/lib/slimPins";
import { applyPlacesEnrichment } from "@/lib/venuePlacesEnrichment";

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
