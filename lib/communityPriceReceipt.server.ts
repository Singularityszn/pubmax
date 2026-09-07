import "server-only";

import { randomUUID } from "node:crypto";

import {
  submitCommunityPrice,
  type CommunityPriceWrite,
  type CommunityPriceWriteResult,
} from "@/lib/communityPriceStore";
import { deletePhotos, uploadPhoto } from "@/lib/pintDropsStore";
import { log } from "@/lib/log";

export type CommunityPriceWithReceiptResult = CommunityPriceWriteResult & {
  receiptStatus: "stored" | "superseded" | "unavailable";
};

/** Upload and attach evidence. The caller decides how an unavailable receipt affects its response. */
export async function submitCommunityPriceWithReceipt(
  input: Omit<CommunityPriceWrite, "receiptPhotoKey"> & { actor: string },
  receipt: File,
  now = Date.now(),
): Promise<CommunityPriceWithReceiptResult> {
  if (!input.actor.trim()) throw new Error("Receipt attachment needs an attributed price.");
  const generation = randomUUID();
  // Capture the observation time before upload: a slow file must not replace a newer price.
  const key = await uploadPhoto("receipt", input.venueId, generation, receipt);
  let result: CommunityPriceWriteResult;
  try {
    result = await submitCommunityPrice({ ...input, receiptPhotoKey: key }, now);
  } catch (error) {
    // The transaction may have committed. Its object is unsafe to delete until a read can prove otherwise.
    log("warn", "community_price.receipt_attachment_unknown", { generation, venueId: input.venueId });
    throw error;
  }
  const write = result.receiptWrite;
  if (write?.applied && write.key === key) {
    if (write.replacedKey && write.replacedKey !== key) await deletePhotos([write.replacedKey]);
    return { ...result, receiptStatus: "stored" };
  }
  if (write && !write.applied) {
    if (write.key !== key) await deletePhotos([key]);
    return { ...result, receiptStatus: write.key === key ? "stored" : "superseded" };
  }
  log("warn", "community_price.receipt_attachment_unknown", { generation, venueId: input.venueId });
  return { ...result, receiptStatus: "unavailable" };
}
