import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, type Locator, type Page, type Request } from "@playwright/test";

// THE BILL EVERY LOGGED PRICE CARRIES (captain 7 Sept 2026).
//
// Since `lib/pintDropReceipt.ts` a new price does not leave the composer, and
// is not accepted by either write route, without a photo of the bill. Every
// spec that taps "Log it" therefore attaches one first, exactly as a drinker
// standing at the bar does.
//
// ONE helper rather than a stub per spec, so the day the picker moves there is
// one place to follow it, and so no spec quietly starts asserting against a
// composer that would refuse a real person.

/** A real baseline JPEG of a receipt. The upload path sniffs the leading bytes,
 *  so an invented buffer would be refused for the wrong reason, and the proof
 *  shots print this thumbnail, so it has to DECODE as well as validate. */
export const BILL_FIXTURE = join(process.cwd(), "e2e/fixtures/bill.jpg");

/**
 * Attach the bill to the one-tap composer inside `scope`.
 *
 * The picker's input is visually hidden, which `setInputFiles` does not mind.
 * `.first()` is the BILL's input: the pint photo's own picker only renders once
 * the bill is in, and it renders after it.
 */
export async function attachBill(scope: Page | Locator): Promise<void> {
  await scope.locator("input.vpsubPhotoInput").first().setInputFiles(BILL_FIXTURE);
}

/** Attach the bill to the full Pint Drop composer (the Spill sheet). */
export async function attachSpillBill(scope: Page | Locator): Promise<void> {
  await scope
    .getByLabel(/Snap the bill|The bill: snap or upload/i)
    .setInputFiles(BILL_FIXTURE);
}


type PriceUpload = {
  fields: Record<string, string>;
  receipt: { name: string; type: string; bytes: number[] } | null;
};

/** Capture the Files passed to fetch. Chromium omits their bytes from request events. */
export async function installPriceUploadCapture(page: Page, endpoint: string) {
  const uploads: PriceUpload[] = [];
  const originalBill = await readFile(BILL_FIXTURE);
  await page.exposeFunction("__capturePriceUpload", (upload: PriceUpload) => {
    uploads.push(upload);
  });
  await page.addInitScript((path) => {
    const originalFetch = window.fetch;
    window.fetch = async (input, init) => {
      if (String(input) === path && init?.method === "POST" && init.body instanceof FormData) {
        const fields: Record<string, string> = {};
        init.body.forEach((value, key) => {
          if (typeof value === "string") fields[key] = value;
        });
        const receipt = init.body.get("receipt_photo");
        await (window as Window & {
          __capturePriceUpload: (upload: PriceUpload) => Promise<void>;
        }).__capturePriceUpload({
          fields,
          receipt: receipt instanceof File ? {
            name: receipt.name,
            type: receipt.type,
            bytes: Array.from(new Uint8Array(await receipt.arrayBuffer())),
          } : null,
        });
      }
      return originalFetch(input, init);
    };
  }, endpoint);

  return async (request: Request): Promise<Record<string, string>> => {
    expect(new URL(request.url()).pathname).toBe(endpoint);
    const contentType = request.headers()["content-type"];
    expect(contentType).toContain("multipart/form-data");
    const form = await new Response(Uint8Array.from(request.postDataBuffer() ?? []), {
      headers: { "content-type": contentType },
    }).formData();
    const fields = Object.fromEntries([...form].filter((entry) => typeof entry[1] === "string"));
    const upload = uploads.shift();
    expect(upload, "the actual fetch must carry this multipart submission").toBeDefined();
    expect(upload!.fields).toEqual(fields);
    expect(upload!.receipt).toMatchObject({ name: "bill.jpg", type: "image/jpeg" });
    expect(Buffer.from(upload!.receipt!.bytes)).toEqual(originalBill);
    expect(form.get("receipt_photo")).toMatchObject({ name: "bill.jpg", type: "image/jpeg" });
    return upload!.fields;
  };
}
