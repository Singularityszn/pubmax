import { join } from "node:path";

import type { Locator, Page, Request } from "@playwright/test";

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

/** The fields a `/api/price-submit` write carried, as a route double reads them. */
export type PriceSubmission = {
  venueId?: string;
  drinkCategory?: string;
  priceGbp?: number;
  measure?: string;
  measureLabel?: string;
  kind?: string;
  signalKey?: string;
  signalValue?: string;
  /** True when the bill rode in the form. */
  hasReceipt: boolean;
};

/**
 * Read a `/api/price-submit` POST the way the route reads it.
 *
 * A write that carries the bill is a multipart form
 * (`lib/communityContributionClient.ts`), so `postDataJSON()` throws on every
 * priced write. A venue signal carries no photo and still goes as JSON. The
 * form sends `priceGbp` as text, so it comes back a number here, as in JSON.
 */
export function readPriceSubmission(request: Request): PriceSubmission {
  const contentType = request.headers()["content-type"] ?? "";
  if (!contentType.startsWith("multipart/form-data")) {
    const body = (request.postDataJSON() ?? {}) as Omit<PriceSubmission, "hasReceipt">;
    return { ...body, hasReceipt: false };
  }
  const raw = request.postDataBuffer()?.toString("latin1") ?? "";
  const fields: Record<string, string> = {};
  // A file part names a filename before its blank line, so only text fields match.
  for (const match of raw.matchAll(/name="([^"]+)"\r\n\r\n([^\r]*)\r\n/g)) {
    fields[match[1]] = match[2];
  }
  return {
    ...fields,
    priceGbp: fields.priceGbp === undefined ? undefined : Number(fields.priceGbp),
    hasReceipt: raw.includes('name="receipt_photo"'),
  };
}

/** Attach the bill to the full Pint Drop composer (the Spill sheet). */
export async function attachSpillBill(scope: Page | Locator): Promise<void> {
  await scope
    .getByLabel(/Snap the bill|The bill: snap or upload/i)
    .setInputFiles(BILL_FIXTURE);
}
