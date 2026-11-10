import "server-only";

import { createHash } from "node:crypto";

export function oneTapPriceDropId(id: string, submittedAt: number, priceGbp: number): string {
  const hex = createHash("md5").update(`${id}:${submittedAt}:${Math.round(priceGbp * 100)}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
