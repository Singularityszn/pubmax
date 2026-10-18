// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import GardenTonightCard from "@/components/discovery/GardenTonightCard";
import { clearSurfaceCache } from "@/lib/surfaceDataCache";

// Controlled fixtures, never live London weather, places or seats. The sunset
// is a calculation for a map point on the real clock's date. Nothing here
// proves a garden, its direction, shade, opening hours or a free seat.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;

const FRESH_GARDEN_WEATHER = { feelsLikeC: 22, precipProbabilityPct: 10, isDay: true };

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

function londonParts(instant: Date) {
  const pick = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", ...options }).format(instant);
  return {
    day: pick({ day: "numeric" }),
    monthLong: pick({ month: "long" }),
    monthShort: pick({ month: "short" }),
    year: pick({ year: "numeric" }),
    clock: pick({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
  };
}

beforeEach(() => {
  clearSurfaceCache();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  clearSurfaceCache();
  vi.unstubAllGlobals();
});

describe("GardenTonightCard dates a calculated sunset for each place's map point", () => {
  it("shows an absolute London sunset for a located place and no sunset claim for an unlocated one", async () => {
    servePlaces([LOCATED_PLACE, UNLOCATED_PLACE]);
    await renderCard();

    // Controls the current card already meets: the gate, the headline and the place order.
    const section = host.querySelector<HTMLElement>(".gardenTonightSection");
    expect(section).not.toBeNull();
    expect(host.querySelector("#gardenTonight-title")?.textContent).toBe(
      "Feels like 22°C, 10% chance of rain. Beer-garden weather.",
    );
    expect(Array.from(host.querySelectorAll(".gardenTonightPubName"), (name) => name.textContent)).toEqual([
      "Fixture Located Pub",
      "Fixture Unlocated Pub",
    ]);
    const unlocated = rowNamed("Fixture Unlocated Pub");
    expect(unlocated.querySelector("time")).toBeNull();
    expect(unlocated.textContent).not.toMatch(/sunset/i);

    // The located place carries one absolute, dated prediction in London time.
    const located = rowNamed("Fixture Located Pub");
    const times = located.querySelectorAll("time");
    expect(times).toHaveLength(1);
    const iso = times[0]!.getAttribute("datetime") ?? "";
    const instant = new Date(iso);
    expect(Number.isFinite(instant.getTime())).toBe(true);
    expect(instant.toISOString()).toBe(iso);
    const visible = times[0]!.textContent ?? "";
    const london = londonParts(instant);
    expect(visible).toMatch(new RegExp(`\\b${london.day} (?:${london.monthLong}|${london.monthShort})\\b`));
    expect(visible).toContain(london.year);
    expect(visible).toContain(london.clock);
    expect(located.textContent).toMatch(/\bsunset\b/i);
    expect(located.textContent).toMatch(/\bLondon time\b/);
    expect(located.textContent).not.toMatch(/\b(?:was|today|tonight|left|until)\b/i);
    expect(section!.querySelectorAll("time")).toHaveLength(1);

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
  });
});
