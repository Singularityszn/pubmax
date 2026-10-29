import "server-only";

import { magicBytesOk } from "@/lib/imageSafety";
import { photoRefusal } from "@/lib/pintDropReceipt";

/**
 * Why the attached bill is not a photo we could keep, or null. Every price
 * door asks this one question: the declared type and size, then the leading
 * bytes, so any non-empty file cannot pass for the bill a price is owed.
 */
export async function receiptPhotoRefusal(receipt: File | null | undefined): Promise<string | null> {
  if (!receipt) return null;
  const refusal = photoRefusal(receipt);
  if (refusal) return refusal;
  const head = new Uint8Array(await receipt.slice(0, 64).arrayBuffer());
  return magicBytesOk(head, receipt.type) ? null : "Photo must be a JPEG, PNG, or WebP image.";
}
