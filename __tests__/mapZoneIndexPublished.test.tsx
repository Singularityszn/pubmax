import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// F08 of the public QA pass: the map's Filters sheet rolled the fare-zone
// medians up from the pubs the map had LOADED so far, so a phone read Zone 2
// 5.75, Zone 3 5.65 and "2/10 LOG MORE" for Zone 5 while a desktop and
// /pint-index read the whole index. The map now takes the published roll-up
// (`loadZonePintIndex`, the same read /pint-index makes) as a prop.

const seen = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }));

vi.mock("server-only", () => ({}));
vi.mock("next/dynamic", () => ({
  default: () => (props: Record<string, unknown>) => {
    seen.props.push(props);
    return null;
  },
}));
vi.mock("@/components/pintindex/PintIndexMapArrival", () => ({ default: () => null }));

import MapArrivalPage from "@/app/map/arrival/page";
import MapPage from "@/app/map/page";
import PubMaxingShell from "@/components/PubMaxingShell";
import { computeZonePintIndex, MIN_PRICED_VENUES, publishedOrLoadedZoneIndex } from "@/lib/zones";
import { loadZonePintIndex } from "@/lib/zonePintIndex.server";

function shellProps(page: ReactElement): Record<string, unknown> {
  const children = (page.props as { children?: unknown }).children;
  const nodes = Array.isArray(children) ? children : [children];
  const shell = nodes.find(
    (node): node is ReactElement => isValidElement(node) && node.type === PubMaxingShell,
  );
  expect(shell, "the page renders PubMaxingShell").toBeDefined();
  return (shell as ReactElement).props as Record<string, unknown>;
}

describe("the map's fare-zone medians are the published ones", () => {
  it("/map hands the shell the same roll-up /pint-index prints", async () => {
    const published = await loadZonePintIndex();
    expect(published?.rows.some((row) => row.enough)).toBe(true);

    const props = shellProps((await MapPage()) as ReactElement);
    expect(props.zonePintIndex).toEqual(published);
  });

  it("the per-request arrival twin hands the shell the same roll-up", async () => {
    const published = await loadZonePintIndex();
    const page = await MapArrivalPage({ searchParams: Promise.resolve({ band: "cheap" }) });
    expect(shellProps(page as ReactElement).zonePintIndex).toEqual(published);
  });

  it("the shell passes it on to the map untouched", async () => {
    const published = await loadZonePintIndex();
    seen.props.length = 0;
    renderToStaticMarkup(
      createElement(PubMaxingShell, { cityId: "london", zonePintIndex: published }),
    );
    expect(seen.props[0]?.zonePintIndex).toBe(published);
  });

  it("the map prints the published index, and rolls up its loaded venues only without one", () => {
    // Two loaded Zone 2 pubs: far short of a median on their own.
    const loaded = [
      { zone: 2, cheapestPrice: 5.75 },
      { zone: 2, cheapestPrice: 5.65 },
    ];
    const published = computeZonePintIndex(
      Array.from({ length: MIN_PRICED_VENUES }, () => ({ zone: 2, cheapestPrice: 6.1 })),
    );

    expect(publishedOrLoadedZoneIndex(published, loaded)).toBe(published);
    expect(publishedOrLoadedZoneIndex(null, loaded)).toEqual(computeZonePintIndex(loaded));
    expect(publishedOrLoadedZoneIndex(undefined, loaded).rows.find((row) => row.zone === 2)).toEqual(
      expect.objectContaining({ pricedCount: 2, enough: false }),
    );
  });
});
