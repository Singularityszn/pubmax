// Regression: one London map route printed the snapshot line and another did
// not. These call the real route exports and read what each one hands the
// shell, so a route that drops, invents or re-scopes the line shows up in its
// own rendered output. Exact snapshot-date semantics belong to the pure helper
// tests; this file checks route wiring and visible output only.
//
// Doubled boundaries, and only these: the shell (it boots the GPU map; the
// double prints `pricesReadLine` as its only text), the opening preview and
// Pint Index arrival marker (client chrome that renders nothing here), the
// build-time zone index and opening-preview reads, and the UK place resolver
// (no request below names a place, and the double refuses one that does).
// The line itself is still built by lib/mapPricesReadLine.server.ts over the
// real lib/dataFreshness.ts, so its date is the registry's, not this file's.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import MapPage from "@/app/map/page";
import CityMapPage from "@/app/map/[city]/page";
import MapArrivalPage from "@/app/map/arrival/page";

vi.mock("server-only", () => ({}));

vi.mock("@/components/PubMaxingShell", async () => {
  const { createElement } = await import("react");
  return {
    default: ({
      cityId,
      ukNationalBrowse,
      pricesReadLine,
    }: {
      cityId: string;
      ukNationalBrowse?: boolean;
      pricesReadLine?: string | null;
    }) =>
      createElement(
        "output",
        {
          "data-shell-city": cityId,
          "data-uk-national": ukNationalBrowse ? "true" : "false",
        },
        pricesReadLine ?? null,
      ),
  };
});
vi.mock("@/components/map/MapOpeningPreview", () => ({ default: () => null }));
vi.mock("@/components/pintindex/PintIndexMapArrival", () => ({ default: () => null }));
vi.mock("@/lib/mapOpeningPreview.server", () => ({
  loadMapOpeningPreview: async () => [],
  loadMapOpeningGround: () => null,
}));
vi.mock("@/lib/zonePintIndex.server", () => ({ loadZonePintIndex: async () => null }));
vi.mock("@/lib/ukPlaceIndex.server", () => ({
  resolveUkPlaceMapArrival: (params: URLSearchParams) => {
    if (params.get("place")) throw new Error("place arrivals are outside this test");
    return null;
  },
}));

const LONDON_LINE = /London pint prices\. Records from \d{1,2} [A-Z][a-z]+ \d{4}\./g;
const LONDON_SHELL_OUTPUT =
  /<output data-shell-city="london"[^>]*>London pint prices\. Records from \d{1,2} [A-Z][a-z]+ \d{4}\.<\/output>/;

function expectOneLondonLine(markup: string) {
  expect(markup.match(/<output data-shell-city=/g) ?? [], markup).toHaveLength(1);
  expect(markup.match(LONDON_LINE) ?? [], markup).toHaveLength(1);
  expect(markup.match(/pint prices/gi) ?? [], markup).toHaveLength(1);
  expect(markup.match(/Records from/gi) ?? [], markup).toHaveLength(1);
  expect(markup).toMatch(LONDON_SHELL_OUTPUT);
}

function expectNoPriceDate(markup: string, cityId: string) {
  expect(markup.match(/<output data-shell-city=/g) ?? [], markup).toHaveLength(1);
  expect(markup).toMatch(new RegExp(`<output data-shell-city="${cityId}"[^>]*></output>`));
  expect(markup).not.toMatch(/pint prices/i);
  expect(markup).not.toMatch(/Records from/i);
}

async function renderMap() {
  return renderToStaticMarkup(await MapPage());
}

async function renderCityMap(city: string) {
  return renderToStaticMarkup(
    await CityMapPage({ params: Promise.resolve({ city }), searchParams: Promise.resolve({}) }),
  );
}

async function renderArrival(searchParams: Record<string, string>) {
  return renderToStaticMarkup(await MapArrivalPage({ searchParams: Promise.resolve(searchParams) }));
}

describe("London map routes hand the shell the snapshot line", () => {
  it("/map prints one dated London line", async () => {
    expectOneLondonLine(await renderMap());
  });

  it("/map/london prints one dated London line", async () => {
    expectOneLondonLine(await renderCityMap("london"));
  });

  it("/map/arrival with no arrival keys prints one dated London line", async () => {
    const markup = await renderArrival({});
    expect(markup).toContain('data-uk-national="false"');
    expectOneLondonLine(markup);
  });
});

describe("map routes London's prices do not describe", () => {
  it("/map/manchester claims no price date", async () => {
    expectNoPriceDate(await renderCityMap("manchester"), "manchester");
  });

  it("/map/arrival?uk=1 claims no price date", async () => {
    const markup = await renderArrival({ uk: "1" });
    expect(markup).toContain('data-uk-national="true"');
    expectNoPriceDate(markup, "london");
  });
});
