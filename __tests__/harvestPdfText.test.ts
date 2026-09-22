// A PDF MENU IS A MENU, and the words it states go through the same price rules
// as a served document.
//
// The first UK price crawl reached 839 PDFs across 400 hosts and read none of
// them, counting each as a page it could not use. These cases hold the reader
// that closed that gap, and the two ways it is allowed to answer nothing.

import { describe, expect, it } from "vitest";

import { MAX_PDF_BYTES, pdfIsWorthReading, readPdfText } from "@/lib/harvest/pdfText";
import { cheapestPerCategory, pageStatesADrinksList, readVenueDrinkPrices } from "@/lib/harvest/ukPriceCrawl";

import { pdfStating } from "./helpers/harvestPdf";

describe("reading the words a PDF menu states", () => {
  it("reads a drinks list out of a PDF", async () => {
    const text = await readPdfText(
      pdfStating([
        "The Crown Drinks",
        "Neck Oil Session IPA 6.20",
        "Guinness pint 6.80",
        "House red wine 175ml 7.50",
        "Aperol Spritz 9.50",
      ]),
    );
    expect(text).toContain("Neck Oil Session IPA");
    expect(text).toContain("6.20");
  });

  // THE POINT OF THE LANE: what comes out goes through the ordinary rules, so a
  // PDF earns a row exactly where an HTML page would and nowhere else.
  it("hands that text to the same price rules a served page gets", async () => {
    const text = await readPdfText(
      pdfStating([
        "Drinks",
        "Neck Oil Session IPA pint - £6.20",
        "Guinness pint - £6.80",
        "House red wine 175ml - £7.50",
        "Aperol Spritz cocktail - £9.50",
        "Coca-Cola - £3.20",
      ]),
    );
    const reading = readVenueDrinkPrices(text ?? "");
    expect(pageStatesADrinksList(reading)).toBe(true);
    const priced = cheapestPerCategory(reading);
    expect(priced.find((row) => row.category === "beer")?.priceGbp).toBe(6.2);
    expect(priced.find((row) => row.category === "wine")?.priceGbp).toBe(7.5);
  });

  // A PDF WE COULD NOT READ IS A FACT ABOUT US. Both of these answer null, and
  // the crawl counts them apart from a menu that was read and named no drink.
  it.each([
    ["nothing at all", null],
    ["bytes that are not a PDF", new Uint8Array(Buffer.from("<html>not a pdf</html>"))],
    ["an empty document", new Uint8Array(0)],
  ])("answers null for %s rather than guessing", async (_name, bytes) => {
    expect(await readPdfText(bytes as Uint8Array | null)).toBeNull();
  });

  it("refuses a document past the size a menu could be", () => {
    expect(pdfIsWorthReading(MAX_PDF_BYTES)).toBe(true);
    expect(pdfIsWorthReading(MAX_PDF_BYTES + 1)).toBe(false);
    expect(pdfIsWorthReading(0)).toBe(false);
  });
});
