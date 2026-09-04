// Reading the words a PDF menu STATES.
//
// A pub that keeps its drinks list in a PDF has published a price as plainly as
// one that keeps it in an HTML table. The first UK price crawl reached 839 of
// them across 400 hosts and read none, counting each as a page it could not use.
// This is the reader that closes that gap, and it is deliberately a leaf module:
// scripts/harvest/uk-prices/run.mjs ends in a `main()` call, so a reader living
// inside it could not be tested without running a crawl.
//
// WHAT THIS DOES NOT DO. It never renders and it never guesses. A scanned menu
// carries no text layer, so it yields nothing and is COUNTED as unreadable
// rather than being run through an image model that would invent a price. What
// it does return goes through the same lib/harvest/ukPriceCrawl.ts rules as a
// served document: verbatim on the page, a drink word beside it, no food word,
// no offer wording, and a page that states a list rather than a banner.

/**
 * What a PDF menu may cost. A pub's drinks list is a page or two of text; a
 * document far past this is a brochure or a scan, and parsing one costs the
 * whole crawl more than the price it might hold is worth.
 */
export const MAX_PDF_BYTES = 12 * 1024 * 1024;
export const MAX_PDF_PAGES = 12;

/** Whether a PDF is small enough to be worth opening. */
export function pdfIsWorthReading(byteLength: number): boolean {
  return byteLength > 0 && byteLength <= MAX_PDF_BYTES;
}

/**
 * The words a PDF states, or null when it states none we can read.
 *
 * NULL IS A FACT ABOUT US, not about the pub, which is why the caller counts it
 * apart from a menu that was read and named no drink. One document is held at a
 * time and destroyed, because a crawl over hundreds of hosts would otherwise
 * keep every parsed PDF alive at once.
 */
export async function readPdfText(bytes: Uint8Array | null | undefined): Promise<string | null> {
  if (!bytes || !pdfIsWorthReading(bytes.byteLength)) return null;
  let task: { promise: Promise<PdfDocument>; destroy: () => Promise<void> } | undefined;
  try {
    const { getDocument } = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as {
      getDocument: (options: Record<string, unknown>) => {
        promise: Promise<PdfDocument>;
        destroy: () => Promise<void>;
      };
    };
    // `verbosity: 0` is errors only. At its default the parser prints a font
    // warning per embedded face, and a crawl over hundreds of hosts buries its
    // own run report under them.
    task = getDocument({ data: bytes, useSystemFonts: true, isEvalSupported: false, verbosity: 0 });
    const doc = await task.promise;
    const pages = Math.min(doc.numPages, MAX_PDF_PAGES);
    let text = "";
    for (let n = 1; n <= pages; n += 1) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      text += `${content.items
        .map((item) => (typeof (item as { str?: unknown }).str === "string" ? (item as { str: string }).str : ""))
        .join(" ")}\n`;
    }
    return text;
  } catch {
    return null;
  } finally {
    try {
      await task?.destroy();
    } catch {
      // Destroying a document that never opened is not an error worth raising.
    }
  }
}

type PdfDocument = {
  numPages: number;
  getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: unknown[] }> }>;
};
