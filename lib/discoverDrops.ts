import { statedDrinkMeasure } from "@/lib/drinkMeasure";
import type { TonightDrop } from "@/lib/leaderboard";
export function pickDiscoverDrops(raw: unknown): TonightDrop[] {
  if (!raw || typeof raw !== "object") return [];
  const list = (raw as { drops?: unknown }).drops;
  if (!Array.isArray(list)) return [];
  const out: TonightDrop[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const d = item as Record<string, unknown>;
    if (typeof d.venueId !== "string" || !d.venueId) continue;
    out.push({
      venueId: d.venueId,
      drink: typeof d.drink === "string" ? d.drink : undefined,
      measure: d.measure == null ? undefined : statedDrinkMeasure(d.measure) ?? "other",
      priceGbp:
        typeof d.priceGbp === "number" && Number.isFinite(d.priceGbp) ? d.priceGbp : null,
      createdAt: typeof d.createdAt === "string" ? d.createdAt : "",
      handle: typeof d.handle === "string" && d.handle.trim() ? d.handle : undefined,
      venueName:
        typeof d.venueName === "string" && d.venueName.trim() ? d.venueName : undefined,
    });
  }
  return out;
}
