// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import GardenTonightCard from "@/components/discovery/GardenTonightCard";
import { clearSurfaceCache } from "@/lib/surfaceDataCache";
import { daylightForPoint } from "@/lib/weatherDaylight";

// Controlled fixtures, never live London weather, places or seats. The sunset
// is a calculation for a map point on the fixed load-time date. Nothing here
// proves a garden, its direction, shade, opening hours or a free seat.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;

const FRESH_GARDEN_WEATHER = { feelsLikeC: 22, precipProbabilityPct: 10, isDay: true };
const FIXED_LOAD_TIME = "2026-06-18T12:00:00.000Z";

const LOCATED_PLACE = {
  id: "fixture-located",
  name: "Fixture Located Pub",
  area: "Soho",
  location: { lat: 51.5136, lng: -0.1365 },
  types: ["pub"],
  openNow: true,
};

const UNLOCATED_PLACE = {
  id: "fixture-unlocated",
  name: "Fixture Unlocated Pub",
  area: "Soho",
  types: ["pub"],
  openNow: true,
};

const SECOND_LOCATED_PLACE = {
  ...LOCATED_PLACE,
  id: "fixture-greenwich",
  name: "Fixture Greenwich Pub",
  area: "Greenwich",
  location: { lat: 51.4826, lng: -0.0077 },
};

// Finite out-of-range coordinates survive the JSON response unchanged.
const INVALID_LATITUDE_PLACE = {
  ...LOCATED_PLACE,
  id: "fixture-latitude91",
  name: "Fixture Latitude91 Pub",
  location: { lat: 91, lng: -0.1365 },
};

const INVALID_LONGITUDE_PLACE = {
  ...LOCATED_PLACE,
  id: "fixture-longitude181",
  name: "Fixture Longitude181 Pub",
  location: { lat: 51.5136, lng: 181 },
};

function servePlaces(places: readonly Record<string, unknown>[]) {
  vi.stubGlobal("fetch", vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const body = String(input).includes("/api/citymcp/status")
      ? { weather: FRESH_GARDEN_WEATHER }
      : { places };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  }));
}

async function renderCard() {
  await act(async () => {
    root.render(<GardenTonightCard />);
  });
  // Two sequential reads and a deferred state write: let each settle.
  for (let turn = 0; turn < 5; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function rowNamed(name: string): HTMLElement {
  const row = Array.from(host.querySelectorAll<HTMLElement>(".gardenTonightPub")).find(
    (item) => item.querySelector(".gardenTonightPubName")?.textContent === name,
  );
  if (!row) throw new Error(`Missing place row: ${name}`);
  return row;
}

// Visible text split into sentences, so each claim is read whole.
function sentences(text: string): string[] {
  return text.split(".").map((part) => part.trim()).filter(Boolean);
}

function londonClock(instant: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
}

function expectSourceCredit() {
  const note = host.querySelector<HTMLElement>(".gardenTonightNote");
  expect(note).not.toBeNull();
  expect(note!.textContent).toContain("Weather and places via CityMCP London.");
  const credit = [note!, ...note!.querySelectorAll<HTMLElement>("*")].reverse().find(
    (element) => element.textContent?.includes("CityMCP London"),
  );
  // This checks DOM disclosure only. It is not browser visibility evidence.
  expect(credit).toBeDefined();
  expect(credit!.closest('[hidden], [aria-hidden="true"]')).toBeNull();
}

beforeEach(() => {
  // Freeze Date only. The render helper and deferred writes keep real timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(FIXED_LOAD_TIME));
  clearSurfaceCache();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  try {
    act(() => root.unmount());
    host.remove();
    clearSurfaceCache();
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

describe("GardenTonightCard dates a calculated sunset for each place's map point", () => {
  it("shows each located pub's own sunset on the fixed London date and none for an unlocated pub", async () => {
    const locatedPlaces = [LOCATED_PLACE, SECOND_LOCATED_PLACE];
    // Expected instants use fixture inputs and the real helper, never the DOM.
    const expectedSunsets = locatedPlaces.map((place) => {
      const daylight = daylightForPoint(place.location.lat, place.location.lng, new Date(FIXED_LOAD_TIME));
      expect(daylight).not.toBeNull();
      return daylight!.sunsetAt.toISOString();
    });
    expect(new Set(expectedSunsets).size).toBe(2);
    servePlaces([...locatedPlaces, UNLOCATED_PLACE]);
    await renderCard();

    // Controls the current card already meets: the gate, the headline and the place order.
    const section = host.querySelector<HTMLElement>(".gardenTonightSection");
    expect(section).not.toBeNull();
    expect(host.querySelector("#gardenTonight-title")?.textContent).toBe(
      "Feels like 22°C, 10% chance of rain. Beer-garden weather.",
    );
    expect(Array.from(host.querySelectorAll(".gardenTonightPubName"), (name) => name.textContent)).toEqual([
      "Fixture Located Pub",
      "Fixture Greenwich Pub",
      "Fixture Unlocated Pub",
    ]);
    const unlocated = rowNamed("Fixture Unlocated Pub");
    expect(unlocated.querySelector("time")).toBeNull();
    expect(unlocated.textContent).not.toMatch(/sunset/i);

    // Each row carries its own canonical instant and an absolute London label.
    for (const [index, place] of locatedPlaces.entries()) {
      const located = rowNamed(place.name);
      const times = located.querySelectorAll("time");
      expect(times).toHaveLength(1);
      const iso = times[0]!.getAttribute("datetime") ?? "";
      const instant = new Date(iso);
      expect(Number.isFinite(instant.getTime())).toBe(true);
      expect(instant.toISOString()).toBe(iso);
      expect(iso).toBe(expectedSunsets[index]);
      const visible = times[0]!.textContent ?? "";
      expect(visible).toContain("18 June 2026");
      expect(visible).toContain(londonClock(new Date(expectedSunsets[index]!)));
      expect(located.textContent).toMatch(/\bsunset\b/i);
      expect(located.textContent).toMatch(/\bLondon time\b/);
      expect(located.textContent).not.toMatch(/\b(?:was|today|tonight|left|until)\b/i);
      const link = located.querySelector("a");
      expect(link?.textContent).toBe("Map");
      const href = new URL(link!.getAttribute("href")!, "https://fixture.test");
      expect(href.pathname).toBe("/map");
      expect(href.searchParams.get("lat")).toBe(place.location.lat.toFixed(5));
      expect(href.searchParams.get("lng")).toBe(place.location.lng.toFixed(5));
      expect(href.searchParams.get("zoom")).toBe("15");
      expect(href.searchParams.get("q")).toBe(place.name);
    }
    expect(section!.querySelectorAll("time")).toHaveLength(2);

    // The dek promises only places to check. The note says what is calculated,
    // what is a forecast and what nobody has verified.
    expect(host.querySelector(".gardenTonightDek")?.textContent).toBe(
      "Places to check for an outdoor stop in London.",
    );
    const text = section!.textContent ?? "";
    const said = sentences(text);
    expect(said.some((line) => /sunset/i.test(line) && /calculated/i.test(line) && /map point/i.test(line) && /date/i.test(line))).toBe(true);
    expect(said.some((line) => /(?:rain chance|chance of rain)/i.test(line) && /forecast/i.test(line))).toBe(true);
    expect(text).not.toMatch(/\bweather is a forecast\b/i);
    expect(said.some((line) => [/garden/i, /direction/i, /shade/i, /opening hours/i, /free seats/i, /(?:unverified|not verified|not checked)/i].every((pattern) => pattern.test(line)))).toBe(true);
    expect(text).not.toMatch(/right now|\bsunny\b|\bsunshine\b/i);
    expectSourceCredit();
  });

  it("keeps invalid-coordinate pub rows without sunset claims and retains the source credit", async () => {
    servePlaces([LOCATED_PLACE, INVALID_LATITUDE_PLACE, INVALID_LONGITUDE_PLACE]);
    await renderCard();

    const section = host.querySelector(".gardenTonightSection");
    expect(section).not.toBeNull();
    expect(Array.from(host.querySelectorAll(".gardenTonightPubName"), (name) => name.textContent)).toEqual([
      "Fixture Located Pub",
      "Fixture Latitude91 Pub",
      "Fixture Longitude181 Pub",
    ]);
    expect(rowNamed(LOCATED_PLACE.name).querySelectorAll("time")).toHaveLength(1);
    for (const place of [INVALID_LATITUDE_PLACE, INVALID_LONGITUDE_PLACE]) {
      const row = rowNamed(place.name);
      expect(row.querySelector("time")).toBeNull();
      expect(row.textContent).not.toMatch(/sunset/i);
    }
    expect(section!.querySelectorAll("time")).toHaveLength(1);
    expectSourceCredit();
  });

  it("keeps an entirely unlocated card with its forecast disclosure and credit, without a phantom sunset date", async () => {
    const secondUnlocated = {
      ...UNLOCATED_PLACE,
      id: "fixture-second-unlocated",
      name: "Fixture Second Unlocated Pub",
    };
    servePlaces([UNLOCATED_PLACE, secondUnlocated]);
    await renderCard();

    const section = host.querySelector(".gardenTonightSection");
    expect(section).not.toBeNull();
    expect(Array.from(host.querySelectorAll(".gardenTonightPubName"), (name) => name.textContent)).toEqual([
      "Fixture Unlocated Pub",
      "Fixture Second Unlocated Pub",
    ]);
    expect(section!.querySelector("time")).toBeNull();
    expect(section!.querySelector("[datetime]")).toBeNull();
    const text = section!.textContent ?? "";
    expect(text).not.toMatch(/sunset|date shown|London time/i);
    expect(text).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2} [A-Za-z]+ \d{4}\b|\b\d{2}:\d{2}\b/);
    expect(text).not.toMatch(/right now|\b(?:dry|sunny|sunshine)\b/i);
    const note = host.querySelector(".gardenTonightNote")?.textContent ?? "";
    expect(note).toContain("The rain chance is a forecast.");
    expect(note).toContain("A garden, its direction, shade, opening hours and free seats are not verified.");
    expectSourceCredit();
  });
});
