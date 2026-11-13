import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { listedDrinkCoverage } from "@/lib/listedDrinkCoverage";

import FactBlock from "@/components/seo/FactBlock";
import FaqBlock from "@/components/seo/FaqBlock";
import JsonLd from "@/components/seo/JsonLd";
import { faqItems, faqPageJsonLd, pintFactStats, type PricedPubLike } from "@/lib/pintFacts";
import { loadPintPriceLandingVenues } from "@/lib/pintPriceLandingDataset.server";

const opts = { monthYear: "October 2026", observedDate: "2 October 2026", year: "2026" };

function pub(name: string, price: number, read: string, url: string): PricedPubLike {
  return { name, cheapestPrice: price, prices: [{ price_gbp: price, pint_name: `${name} lager`,
    measure: "pint", scraped_at_values: read, pub_url: url }] };
}

function mixedPubs(): PricedPubLike[] {
  return [
    pub("Cheap", 4, "2026-07-03T10:00:00Z", "https://cheap.example/menu"),
    pub("Dear", 6, "2026-10-02T10:00:00Z", "https://dear.example/menu"),
    { name: "Legacy unknown", cheapestPrice: 8 },
    { ...pub("Half", 1, "2026-01-01", "https://half.example/menu"), measure: "pint",
      prices: [{ price_gbp: 1, pint_name: "Half pint lager", measure: "half-pint" }] },
    { ...pub("Bottle", 20, "2026-01-01", "https://bottle.example/menu"),
      prices: [{ price_gbp: 20, pint_name: "BOTTLED BEER" }] },
    { name: "Unpriced", cheapestPrice: null },
  ];
}

function documentFor(pubs: PricedPubLike[]) {
  const stats = pintFactStats(pubs, "Camden", "camden");
  const items = faqItems(stats, opts);
  const html = renderToStaticMarkup(<>
    <FactBlock stats={stats} {...opts} headingId="facts" title="Pint facts" />
    <FaqBlock items={items} headingId="faq" title="Questions" />
    <JsonLd data={faqPageJsonLd(items)!} />
  </>);
  return { stats, document: new JSDOM(html).window.document };
}

describe("fact prices keep their own evidence and population", () => {
  it("excludes the actual bundled bottles without dropping legacy unknown evidence", async () => {
    const pubs = await loadPintPriceLandingVenues();
    expect(pubs).toHaveLength(2180);
    const bbar = pubs.find((row) => row.name === "Bbar")!;
    expect(bbar.cheapestPint).toBe("BOTTLED BEER");
    expect(listedDrinkCoverage([bbar], [])).toMatchObject({ total: 1, pricedPubs: 0, counts: { beer: 0 } });
    const stats = pintFactStats(pubs, "London", "london");
    expect(stats.pubCount).toBe(937);
    expect(stats.totalPubCount).toBe(2180);
    expect(stats.undatedCount).toBe(63);
    expect(stats.minPubName).toBe("J.J. Moon's");
    expect(stats.maxPubName).toBe("Baccarat Bar");
  });

  it("renders one worked average and explicit source/day coverage", () => {
    const { stats, document } = documentFor(mixedPubs());
    expect(stats).toMatchObject({ averageGbp: 6, pubCount: 3, totalPubCount: 6,
      undatedCount: 1, publisherCount: 2 });
    const rows = [...document.querySelectorAll(".factStatTable tr")];
    expect(rows.find((row) => row.textContent?.includes("Average pint"))?.textContent).toContain("£6.00");
    expect(document.querySelector(".factBlockProse")?.textContent).toContain("across 3 tracked pubs");
    expect(document.querySelector(".factBlock")?.textContent).toContain("2 of 3 prices name a publisher. 2 of 3 record a full read day.");
    expect(document.querySelector(".factBlock")?.textContent).not.toContain("£20.00");
    expect(document.querySelector(".factBlock")?.textContent).not.toContain("£1.00");
  });

  it("links each extreme to its own pint, serving, publisher and full day", () => {
    const { document } = documentFor(mixedPubs());
    const rows = [...document.querySelectorAll(".factStatTable tr")];
    const cheap = rows.find((row) => row.textContent?.includes("Cheapest pint"))!;
    const dear = rows.find((row) => row.textContent?.includes("Dearest tracked pint"))!;
    expect(cheap.textContent).toContain("Cheap lager · Pint");
    expect(cheap.querySelector("a")?.href).toBe("https://cheap.example/menu");
    expect(cheap.querySelector("time")?.dateTime).toBe("2026-07-03");
    expect(dear.textContent).toContain("Dear lager · Pint");
    expect(dear.querySelector("a")?.href).toBe("https://dear.example/menu");
    expect(dear.querySelector("time")?.dateTime).toBe("2026-10-02");
  });

  it("does not borrow a later equal-price row's publisher or day", () => {
    const first: PricedPubLike = { name: "Unknown", cheapestPrice: 3, prices: [
      { price_gbp: 3, pint_name: "Original lager" },
      { price_gbp: 3, pint_name: "Other lager", pub_url: "https://other.example/menu", scraped_at_values: "2026-10-02" },
    ] };
    const { stats, document } = documentFor([first]);
    expect(stats).toMatchObject({ averageGbp: 3, pubCount: 1, publisherCount: 0,
      undatedCount: 1, oldestObservedAt: null, minGbp: null, maxGbp: null });
    expect(document.querySelector(".factBlock")?.textContent).toContain("0 of 1 price name a publisher. 0 of 1 record a full read day.");
    expect(document.querySelector(".factBlock a")).toBeNull();
  });

  it("keeps the visible FAQ and parsed JSON-LD identical, with separate extreme days", () => {
    const { document } = documentFor(mixedPubs());
    const ld = JSON.parse(document.querySelector('script[type="application/ld+json"]')!.textContent!);
    const answers = [...document.querySelectorAll(".faqAnswer")].map((node) => node.textContent);
    expect(ld.mainEntity.map((item: { acceptedAnswer: { text: string } }) => item.acceptedAnswer.text)).toEqual(answers);
    const range = answers.find((answer) => answer?.includes("range from"));
    expect(range).toContain("Cheap lager");
    expect(range).toContain("cheap.example");
    expect(range).toContain("3 July 2026");
    expect(range).toContain("Dear lager");
    expect(range).toContain("dear.example");
    expect(range).toContain("2 October 2026");
  });

  it("states an unknown drink and serving without inventing them for a qualified flat price", () => {
    const { document } = documentFor([{ name: "Flat", cheapestPrice: 5,
      priceSource: "Pub menu", priceObservedAt: "2026-10-02" }]);
    expect(document.querySelector(".factStatTable")?.textContent).toContain("Pint name unavailable · Serving size not recorded");
    expect(document.querySelector(".factStatTable")?.textContent).toContain("Pub menu (Link unavailable)");
  });
});
