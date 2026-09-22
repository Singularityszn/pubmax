import { afterEach, describe, expect, it, vi } from "vitest";
import { runCityEnrichment } from "../scripts/lib/tavilyPubEnrichment.mjs";
import { MAX_PDF_BYTES } from "@/lib/harvest/pdfText";
import { pdfStating } from "./helpers/harvestPdf";

const pub = { osmId: "node/1", name: "Independent Arms", lat: 53.4808, lng: -2.2426,
  address: "10 Example Street, Manchester", postcode: "M1 1AA", website: "https://www.independentarms.co.uk/", operator: null, brewery: null };
function harvest(response: Response, suffix = "drinks") {
  return runCityEnrichment({ city: "manchester", pubs: [pub], maxQueries: 1,
    observedAt: "2026-09-22T12:00:00Z", searchProvider: { search: async () => ({ results: [
      { title: "Independent Arms drinks menu", url: `${pub.website}${suffix}` },
    ] }) }, pageFetchImpl: vi.fn(async () => response),
    robotsChecker: async () => ({ allowed: true, reason: "allowed", evidence: "fixture" }),
  });
}
describe("Tavily official page transport", () => {
  afterEach(() => vi.useRealTimers());
  it("reads direct PDF menus through the text-layer reader", async () => {
    const bytes = pdfStating(["Manchester Pale Ale - Pint £5.40"]);
    const result = await harvest(new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf" } }), "drinks.pdf");
    expect(result.prices).toEqual([expect.objectContaining({ drinkName: "Manchester Pale Ale", priceGbp: 5.4 })]);
  });
  it("refuses an oversized official response before consuming its body", async () => {
    const result = await harvest(new Response("Manchester Pale Ale - Pint £5.40", { headers: {
      "content-type": "text/html", "content-length": String(MAX_PDF_BYTES + 1),
    } }));
    expect(result.prices).toEqual([]);
  });
  it("keeps a body that stalls after headers inside the request deadline", async () => {
    vi.useFakeTimers();
    const response = new Response(new ReadableStream({ start() {} }), { headers: { "content-type": "text/html" } });
    const result = harvest(response);
    await vi.advanceTimersByTimeAsync(12_001);
    await expect(result).resolves.toMatchObject({ prices: [], matchedPubs: 0 });
  });
});
