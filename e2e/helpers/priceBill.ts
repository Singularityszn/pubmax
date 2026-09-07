import { join } from "node:path";

import type { Locator, Page } from "@playwright/test";

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

/** A real 131-byte JPEG. The upload path sniffs the leading bytes, so an
 *  invented buffer would be refused for the wrong reason. */
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
