import { statedDrinkMeasure } from "@/lib/drinkMeasure";
import type { TonightDrop } from "@/lib/leaderboard";

// Narrow the public /api/pint-drops payload to the drop shape Discover reads.
// Malformed bodies and rows are ignored so the best-effort lanes stay empty
// instead of crashing the page.
export function pickDiscoverDrops(raw: unknown): TonightDrop[] {
  if (!raw || typeof raw !== "object") return [];
  const list = (raw as { drops?: unknown }).drops;
  if (!Array.isArray(list)) return [];

  const out: TonightDrop[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const drop = item as Record<string, unknown>;
    if (typeof drop.venueId !== "string" || !drop.venueId) continue;
    out.push({
      id: typeof drop.id === "string" && drop.id.trim() ? drop.id : undefined,
      venueId: drop.venueId,
      drink: typeof drop.drink === "string" ? drop.drink : undefined,
      measure:
        drop.measure == null
          ? undefined
          : statedDrinkMeasure(drop.measure) ?? "other",
      measureLabel:
        typeof drop.measureLabel === "string" && drop.measureLabel.trim()
          ? drop.measureLabel
          : undefined,
      priceGbp:
        typeof drop.priceGbp === "number" && Number.isFinite(drop.priceGbp)
          ? drop.priceGbp
          : null,
      createdAt: typeof drop.createdAt === "string" ? drop.createdAt : "",
      handle:
        typeof drop.handle === "string" && drop.handle.trim() ? drop.handle : undefined,
      venueName:
        typeof drop.venueName === "string" && drop.venueName.trim()
          ? drop.venueName
          : undefined,
    });
  }
  return out;
}
