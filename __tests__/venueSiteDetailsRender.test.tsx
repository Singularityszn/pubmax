// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import VenueSiteDetails from "@/components/map/VenueSiteDetails";
import { placesEnrichmentRecord } from "@/lib/placesEnrichment";
import { slimVenueToPin } from "@/lib/slimPins";
import { applyPlacesEnrichment } from "@/lib/venuePlacesEnrichment";
import { applyVenueSiteFacts, type VenueSiteFacts } from "@/lib/venueSiteFacts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
});

const pin = slimVenueToPin({ id: "venue-a", name: "Test Arms", lat: 51.5, lng: -0.1, borough: "Camden", cheapestPrice: null });
const facts: VenueSiteFacts = {
  sourceUrl: "https://test.example/",
  readOn: "2026-10-05",
  dogs: { policy: "welcome", evidence: "Dog Friendly" },
  hours: { hours: { 1: [{ opens: "12:00", closes: "23:00" }], 0: [] }, statedDays: [0, 1], evidence: "Opening hours Monday 12pm - 11pm Sunday closed" },
};

function render(venue: Parameters<typeof VenueSiteDetails>[0]["venue"]) {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(createElement(VenueSiteDetails, { venue })));
  return { container, unmount: () => act(() => root.unmount()) };
}

it("credits the dog policy and hours to the pub's own page and the day it was read", () => {
  const { container, unmount } = render(applyVenueSiteFacts(pin, facts));
  expect(container.querySelector(".amenity")?.textContent).toBe("Dogs welcome");
  expect(container.querySelector(".amenity")?.getAttribute("title")).toBe("Dog Friendly");
  expect([...container.querySelectorAll(".venuePlacesDetailsCredit")].map((credit) => credit.textContent))
    .toEqual(["Pub website · Read 5 Oct 2026", "Pub website · Read 5 Oct 2026"]);
  expect(container.querySelector("a")).toBeNull();
  const days = [...container.querySelectorAll("dl > div")].map((row) => `${row.querySelector("dt")?.textContent}: ${row.querySelector("dd")?.textContent}`);
  expect(days).toEqual([
    "Monday: 12:00 to 23:00",
    "Tuesday: Not stated",
    "Wednesday: Not stated",
    "Thursday: Not stated",
    "Friday: Not stated",
    "Saturday: Not stated",
    "Sunday: Closed",
  ]);
  unmount();
});

it("says No dogs for a refusal and renders nothing without site facts", () => {
  const refused = render(applyVenueSiteFacts(pin, { sourceUrl: "https://test.example/", readOn: "2026-10-05", dogs: { policy: "not-allowed", evidence: "No dogs" } }));
  expect(refused.container.querySelector(".amenity--absent")?.textContent).toBe("No dogs");
  refused.unmount();
  const none = render(pin);
  expect(none.container.innerHTML).toBe("");
  none.unmount();
});

it("does not repeat a fact Google Places already answers", () => {
  const record = placesEnrichmentRecord("venue-a", "ChIJVerified123", {
    allowsDogs: false,
    regularOpeningHours: { periods: [{ open: { day: 1, hour: 11, minute: 0 }, close: { day: 1, hour: 23, minute: 0 } }] },
  }, "2026-10-01T09:00:00Z");
  const { container, unmount } = render(applyPlacesEnrichment(applyVenueSiteFacts(pin, facts), record));
  expect(container.innerHTML).toBe("");
  unmount();
});

it("shows the site's hours when Google Places hours are too old to decide open state", () => {
  const record = placesEnrichmentRecord("venue-a", "ChIJVerified123", {
    regularOpeningHours: { periods: [{ open: { day: 1, hour: 11, minute: 0 }, close: { day: 1, hour: 23, minute: 0 } }] },
  }, "2026-08-06T09:00:00Z");
  const venue = applyPlacesEnrichment(applyVenueSiteFacts(pin, facts), record);
  expect(venue.openingHours).toEqual(facts.hours?.hours);
  const { container, unmount } = render(venue);
  expect(container.querySelector("dl > div dd")?.textContent).toBe("12:00 to 23:00");
  unmount();
});
