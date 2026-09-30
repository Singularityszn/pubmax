// A PDF MENU IS A MENU, and the words it states go through the same price rules
// as a served document.
//
// The first UK price crawl reached 839 PDFs across 400 hosts and read none of
// them, counting each as a page it could not use. These cases hold the reader
// that closed that gap, and the two ways it is allowed to answer nothing.

import { describe, expect, it } from "vitest";

import { MAX_PDF_BYTES, pdfIsWorthReading, readPdfText } from "@/lib/harvest/pdfText";
import { cheapestPerCategory, pageStatesADrinksList, readVenueDrinkPrices } from "@/lib/harvest/ukPriceCrawl";

/**
 * The smallest valid PDF that carries a text layer, built here rather than
 * committed as a binary so the fixture's own contents are readable in the diff.
 */
function pdfStating(lines: readonly string[]): Uint8Array {
  const stream = `BT /F1 12 Tf 40 760 Td 14 TL\n${lines
    .map((line) => `(${line.replace(/([()\\])/g, "\\$1")}) Tj T*`)
    .join("\n")}\nET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n `)
    .join("\n")}\n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

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

  it("keeps separate printed rows from changing neighbouring drink categories", async () => {
    const text = await readPdfText(
      pdfStating([
        "Drinks menu",
        "Guinness Draught pint £6.10",
        "Heineken 0.0% lager £5.00",
        "Camden Hells Lager pint £5.40",
        "Negroni on tap £9.00",
        "Espresso Martini on draught £10.00",
        "House red wine 175ml £6.50",
      ]),
    );
    const reading = readVenueDrinkPrices(text ?? "", "text");
    expect(reading.drops).toEqual([]);
    expect(pageStatesADrinksList(reading)).toBe(true);
    expect(reading.kept).toEqual([
      expect.objectContaining({ category: "beer", priceGbp: 6.1 }),
      expect.objectContaining({ category: "alcohol-free", priceGbp: 5, drinkLabel: "Heineken 0.0% lager" }),
      expect.objectContaining({ category: "beer", priceGbp: 5.4, drinkLabel: "Camden Hells Lager pint" }),
      expect.objectContaining({ category: "cocktail", priceGbp: 9, drinkLabel: "Negroni on tap" }),
      expect.objectContaining({ category: "cocktail", priceGbp: 10, drinkLabel: "Espresso Martini on draught" }),
      expect.objectContaining({ category: "wine", priceGbp: 6.5, drinkLabel: "House red wine", servingSize: "175ml" }),
    ]);
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
