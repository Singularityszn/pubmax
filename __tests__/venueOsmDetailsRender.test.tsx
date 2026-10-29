// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import path from "node:path";

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import VenueOsmDetails from "@/components/map/VenueOsmDetails";
import type { OsmPubFacts } from "@/lib/osmPubFacts";
import { OSM_PUB_FACTS_TRACING_INCLUDE } from "@/lib/osmPubFactsFile.mjs";

const pack = JSON.parse(readFileSync(path.join(process.cwd(), OSM_PUB_FACTS_TRACING_INCLUDE), "utf8"));

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
    "Facts from OpenStreetMap contributors, ODbL",
  ]);
  const links = [...container.querySelectorAll("a")].map((link) => [link.textContent, link.getAttribute("href")]);
  expect(links).toEqual([
    ["Instagram", "https://www.instagram.com/testarms"],
    ["OpenStreetMap contributors", "https://www.openstreetmap.org/copyright"],
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

it("prints a close in the first hour after midnight as the next day's clock, and keeps 24:00", () => {
  // Every committed row with a minute past 24:00. Each must print `00:mm next day`.
  const pastMidnight: Record<string, string> = {
    "node/12961239334": "Su-We 12:00-24:00; Th 12:00-24:30; Fr-Sa 12:00-25:00",
    "node/13054215867": "Mo-Th 15:00-24:30; Fr-Su 13:30-24:30",
    "node/348782665": "Su-We 12:00-23:00; Th 12:00-24:00;Fr-Sa 12:00-24:45",
    "node/385018022": "Mo-Th 12:00-23:30; Fr-Sa 12:00-24:30; Su 12:00-23:30",
    "node/4067222289": "Mo-Tu 13:30-23:00; We-Th 12:00-23:00; Fr 12:00-24:30; Sa 11:00-24:30; Su 12:00-21:00",
    "node/6583527630": "Mo-We 12:00-00:00; Th 12:00-24:30; Fr-Sa 12:00-26:00; Su 12:00-22:30",
    "node/6677415686": "Mo,Tu,We,Su 08:00-23:30; Th 08:00-24:30; Fr,Sa 08:00-25:30",
    "way/1240494104": "Mo-Su 10:00-24:15",
    "way/1285226741": "Mo Off; Tu Off; We Off; Th 15:00-23:00; Fr 15:00-24:30; Sa 12:00-24:30; Su 12:00-22:00",
    "way/934330566": "Mo-Th 17:00-23:00; Fr 14:00-24:30; Sa 12:00-24:30; Su 12:00-22:00",
  };
  const committed = (pack.rows as OsmPubFacts[])
    .filter((row) => /(?:^|-)24:(?!00)\d{2}\b/.test(row.openingHours ?? ""))
    .map((row) => [row.osmId, row.openingHours]);
  expect(Object.fromEntries(committed)).toEqual(pastMidnight);
  for (const [osmId, openingHours] of Object.entries(pastMidnight)) {
    const { container, unmount } = render({ osmId, readOn: "2026-10-05", openingHours });
    const closes = [...container.querySelectorAll("details dl dd")].map((row) => row.textContent ?? "");
    expect(closes.length, osmId).toBe(7);
    expect(closes.join(" | "), osmId).not.toMatch(/\b24:(?!00)\d{2}/);
    expect(closes.join(" | "), osmId).toMatch(/to 00:(?:15|30|45) next day/);
    unmount();
  }
  const { container, unmount } = render({ osmId: "way/1240494104", readOn: "2026-10-05", openingHours: "Mo-Su 10:00-24:15" });
  expect(container.querySelector("details dl dd")?.textContent).toBe("10:00 to 00:15 next day");
  unmount();
  const lucky = render({ osmId: "node/12961239334", readOn: "2026-10-05", openingHours: pastMidnight["node/12961239334"] });
  const days = [...lucky.container.querySelectorAll("details dl > div")].map((row) => `${row.querySelector("dt")?.textContent}: ${row.querySelector("dd")?.textContent}`);
  expect(days).toContain("Monday: 12:00 to 24:00");
  expect(days).toContain("Thursday: 12:00 to 00:30 next day");
  expect(days).toContain("Friday: 12:00 to 01:00 next day");
  lucky.unmount();
});

it("prints a public-holiday day list as OSM writes it, never a Sunday-only table", () => {
  // Ghost Whale, `node/11006274641`, in the committed pack.
  const openingHours = "Mo 16:00-20:00; Tu 16:00-21:00; We 16:00-23:00; Th-Sa 12:00-23:00; Su,PH 12:00-20:00";
  const { container, unmount } = render({ osmId: "node/11006274641", readOn: "2026-10-05", openingHours });
  expect(container.querySelector("details dl")).toBeNull();
  expect(container.querySelector("details p")?.textContent).toBe(openingHours);
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
