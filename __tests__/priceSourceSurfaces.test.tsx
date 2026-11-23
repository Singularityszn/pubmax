// @vitest-environment jsdom
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import FairPintStops from "@/components/map/fairpint/FairPintStops";
import ListedPriceLine from "@/components/map/inspector/ListedPriceLine";
import PlanPintPriceCaption from "@/components/plan/PlanPintPriceCaption";
import { HuntSource } from "@/components/landing/LandingHuntCard";
import ListedPriceSource from "@/components/venue/ListedPriceSource";

// The owner's own cases live in priceSourceLink.test.tsx. These are the
// surfaces that printed a publisher link from their own record.
const HOSTILE = [
  "javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "vbscript:msgbox(1)",
  "/pubs/evil",
  "pint-prices.com/pub/1",
  "https://user:pass@evil.example/pint",
  "https://pint-prices.com@evil.example/pint",
] as const;
const SAFE = "https://www.pint-prices.com/pub/example";

function html(element: ReactElement): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(element);
  return host;
}

const READ = "2026-10-09T12:00:00.000Z";

/** Each surface that printed a publisher link from its own record, given that record. */
const SURFACES: Record<string, (url: string) => ReactElement> = {
  ListedPriceSource: (url) => <ListedPriceSource evidence={{ publisher: { label: "Pint Prices", url }, observedOn: "2026-10-09" }} />,
  ListedPriceLine: (url) => <ListedPriceLine listed={{ priceGbp: 5.2, sourceUrl: url, observedAt: READ, publisher: "Pint Prices" }} />,
  PlanPintPriceCaption: (url) => (
    <PlanPintPriceCaption evidence={{ venueId: "v", pence: 520, serving: "pint", source: { label: "Pint Prices", url, observedAt: READ } }} />
  ),
  HuntSource: (url) => (
    <HuntSource className="hunt" pint={{
      venueId: "v", pubName: "The Dog", cityId: "london", placeName: "London", priceGbp: 5.2,
      publisher: { label: "Pint Prices", url }, observedOn: "2026-10-09", standing: "listed", lane: "uk-bundle", mapHref: "/map",
    }} />
  ),
  FairPintStops: (url) => (
    <FairPintStops stops={[{
      venueId: "v", venueName: "The Dog", priceCategory: "lager",
      listed: { pence: 520, source: { label: "Pint Prices", url, observedAt: READ } },
    }] as unknown as Parameters<typeof FairPintStops>[0]["stops"]} />
  ),
};

describe.each(Object.entries(SURFACES))("%s", (_name, render) => {
  it("links a safe publisher URL", () => {
    const link = html(render(SAFE)).querySelector("a");
    expect(link?.getAttribute("href")).toBe(SAFE);
    expect(link?.textContent).toBe("Pint Prices");
    expect(link?.getAttribute("rel")).toContain("noopener");
  });

  it.each(HOSTILE)("keeps the label as text and says the link is unavailable for %j", (url) => {
    const host = html(render(url));
    expect(host.querySelector("a")).toBeNull();
    expect(host.textContent).toContain("Pint Prices. Link unavailable.");
    expect(host.textContent).not.toContain("Publisher not recorded");
  });
});

it("ListedPriceLine says no publisher was recorded instead of naming one", () => {
  const host = html(<ListedPriceLine listed={{ priceGbp: 5.2, sourceUrl: SAFE, observedAt: READ, publisher: null }} />);
  expect(host.textContent).toContain("Publisher not recorded");
  expect(host.textContent).not.toContain("Listed by source");
  expect(host.querySelector("a")).toBeNull();
});
