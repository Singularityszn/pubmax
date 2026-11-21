import "server-only";
import type { PublicPricePresence } from "@/lib/publicPricePresence";

export async function readPublicBasePricePresence(ids: readonly string[]): Promise<Record<string, PublicPricePresence>> {
  return Object.fromEntries(ids.map((id) => [id, "unknown"]));
}
