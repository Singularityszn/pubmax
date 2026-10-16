// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import VenueOsmDetails from "@/components/map/VenueOsmDetails";
import type { OsmPubFacts } from "@/lib/osmPubFacts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(facts: OsmPubFacts | null | undefined) {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(createElement(VenueOsmDetails, { facts })));
  return { container, unmount: () => act(() => root.unmount()) };
}

const facts: OsmPubFacts = {
  osmId: "way/1",
  readOn: "2026-10-05",
  checkDate: "2023-12-10",
  openingHours: "Mo-Th 12:00-23:00; Su off",
  wheelchair: "limited",
  liveSport: "yes",
  dog: "no",
  instagram: "testarms",
  brand: "Test Pub Company",
};

it("prints each OSM fact with its source and day, and the ODbL credit", () => {
  const { container, unmount } = render(facts);
  expect(container.querySelector("summary")?.textContent).toBe("OpenStreetMap opening hours");
  const days = [...container.querySelectorAll("details dl > div")].map((row) => `${row.querySelector("dt")?.textContent}: ${row.querySelector("dd")?.textContent}`);
  expect(days).toEqual([
    "Monday: 12:00 to 23:00",
    "Tuesday: 12:00 to 23:00",
    "Wednesday: 12:00 to 23:00",
    "Thursday: 12:00 to 23:00",
    "Friday: Not stated",
    "Saturday: Not stated",
    "Sunday: Closed",
  ]);
  expect([...container.querySelectorAll(".amenity")].map((chip) => chip.textContent)).toEqual([
    "Limited wheelchair access",
    "Shows live sport",
    "No dogs",
  ]);
  expect(container.querySelector(".amenity--absent")?.textContent).toBe("No dogs");
  expect([...container.querySelectorAll(".venuePlacesDetailsCredit")].map((credit) => credit.textContent)).toEqual([
    "OpenStreetMap hours, checked 10 Dec 2023",
    "OpenStreetMap, checked 10 Dec 2023",
    "© OpenStreetMap contributors, ODbL",
  ]);
  const links = [...container.querySelectorAll("a")].map((link) => [link.textContent, link.getAttribute("href")]);
  expect(links).toEqual([
    ["Instagram", "https://www.instagram.com/testarms"],
    ["© OpenStreetMap contributors", "https://www.openstreetmap.org/copyright"],
  ]);
  unmount();
});

it("prints a close past midnight as the next day's clock, never an hour past 24", () => {
  // `Fr-Sa 18:00-28:00` is in the committed pack: 28:00 is 04:00 on Saturday.
  const { container, unmount } = render({ osmId: "node/224146236", readOn: "2026-10-05", openingHours: "Th 18:00-24:00; Fr-Sa 18:00-28:00" });
  const days = [...container.querySelectorAll("details dl > div")].map((row) => `${row.querySelector("dt")?.textContent}: ${row.querySelector("dd")?.textContent}`);
  expect(days).toContain("Thursday: 18:00 to 24:00");
  expect(days).toContain("Friday: 18:00 to 04:00 next day");
  expect(days).toContain("Saturday: 18:00 to 04:00 next day");
  unmount();
});

it("prints hours that do not read cleanly as OSM writes them", () => {
  const { container, unmount } = render({ osmId: "node/2", readOn: "2026-10-05", openingHours: "Mo-Su 12:00-23:00; PH off" });
  expect(container.querySelector("details p")?.textContent).toBe("Mo-Su 12:00-23:00; PH off");
  expect(container.querySelector("details dl")).toBeNull();
  expect(container.querySelector(".venuePlacesDetailsCredit")?.textContent).toBe("OpenStreetMap hours, read 5 Oct 2026");
  unmount();
});

it("renders nothing when OSM states nothing printable", () => {
  expect(render(undefined).container.innerHTML).toBe("");
  expect(render({ osmId: "node/3", readOn: "2026-10-05", brewery: "yes" }).container.innerHTML).toBe("");
});
