import "server-only";

import { createHash } from "node:crypto";

export function oneTapPriceDropId(id: string, submittedAt: number, priceGbp: number): string {
  const hash = createHash("sha1")
    .update(Buffer.from(id.replaceAll("-", ""), "hex"))
    .update(`${submittedAt}:${priceGbp}`)
    .digest();
  hash.writeUInt8((hash.readUInt8(6) & 0x0f) | 0x50, 6);
  hash.writeUInt8((hash.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = hash.toString("hex", 0, 16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
