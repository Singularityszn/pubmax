// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BoroughPintPriceCard from "@/components/borough/BoroughPintPriceCard";
import { listBoroughs } from "@/lib/boroughs";
import { clearSurfaceCache } from "@/lib/surfaceDataCache";
import type { Venue } from "@/lib/venues";
import { trimCityArea } from "@/lib/citymcp/area";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | null = null;
let asOf: string | null;

beforeEach(() => {
  clearSurfaceCache();
  asOf = "2026-10-02T10:00:00Z";
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(trimCityArea("Westminster", {
    pint: { asOf, value: { borough: "Westminster", averagePriceGbp: 6.2 } },
  })), { status: 200, headers: { "Content-Type": "application/json" } })));
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  clearSurfaceCache();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function cheapest() {
  return listBoroughs([{
    id: "selected-arms", name: "The Selected Arms", primaryBorough: "Westminster",
    cheapestPrice: 3.5, cheapestPint: "Selected lager", prices: [{
      pint_name: "Selected lager", price_gbp: 3.5, measure: "pint",
      pub_url: "https://first.example/menu", scraped_at_values: "2026-01-12",
    }],
  } as Venue])[0]!.cheapestPint;
}

async function mount(ourCheapestPint = cheapest()) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<BoroughPintPriceCard boroughName="Westminster" ourCheapestPint={ourCheapestPint} />));
  return host;
}

describe("borough CityMCP comparison evidence", () => {
  it("separates the upstream average's full day from the local winning pint's receipt", async () => {
    const host = await mount();
    expect(host.textContent).toContain("CityMCP");
    expect(host.textContent).toContain("Average pint in Westminster: £6.20");
    expect(host.querySelector('time[dateTime="2026-10-02"]')?.textContent).toBe("2 October 2026");
    const local = host.querySelector(".boroughPintChipCompare")!;
    expect(local.textContent).toContain("£3.50");
    expect(local.textContent).toContain("The Selected Arms");
    expect(local.textContent).toContain("Selected lager · Pint");
    expect(local.querySelector('a[target="_blank"]')?.getAttribute("href")).toBe("https://first.example/menu");
    expect(local.querySelector("time")?.textContent).toBe("12 January 2026");
  });

  it.each([null, "", "2026", "2026-10", "2026-02-30", "bad-date"])("does not invent an upstream day from %s", async (value) => {
    asOf = value;
    const host = await mount(null);
    expect(host.textContent).toContain("Average pint in Westminster: £6.20");
    expect(host.textContent).toContain("Read date unavailable");
    expect(host.querySelector("time")).toBeNull();
    expect(host.querySelector(".boroughPintChipCompare")).toBeNull();
  });

  it.each([
    ["2026-10-02", "2026-10-02", "2 October 2026"],
    ["2026-10-02T23:30:00Z", "2026-10-03", "3 October 2026"],
    ["2026-10-02T00:30:00+13:00", "2026-10-01", "1 October 2026"],
  ])("shows the actual complete London day for %s", async (value, day, label) => {
    asOf = value;
    const host = await mount(null);
    expect(host.querySelector("time")?.getAttribute("dateTime")).toBe(day);
    expect(host.querySelector("time")?.textContent).toBe(label);
  });

  it.each(["UTC", "Pacific/Auckland"])("does not invent an instant's timezone on a %s device", async (timezone) => {
    vi.stubEnv("TZ", timezone);
    asOf = "2026-10-02T00:30:00";
    expect(trimCityArea("Westminster", { pint: { asOf } }).asOf).toBe(asOf);
    const host = await mount(null);
    expect(host.textContent).toContain("Average pint in Westminster: £6.20");
    expect(host.textContent).toContain("Read date unavailable");
    expect(host.querySelector("time")).toBeNull();
  });

  it.each(["UTC", "Pacific/Auckland"])("preserves a stated calendar day on a %s device", async (timezone) => {
    vi.stubEnv("TZ", timezone);
    asOf = "2026-10-02";
    const host = await mount(null);
    expect(host.querySelector("time")?.getAttribute("dateTime")).toBe("2026-10-02");
    expect(host.querySelector("time")?.textContent).toBe("2 October 2026");
  });
});
