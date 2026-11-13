import "server-only";

// Mates' prices (launch review F8): the newest price each of the reader's
// MUTUAL friends logged at one pub, up to three, read live.
//
// Who counts is the follow graph's mutuals and nobody else: never a follower
// alone, never a stranger. What counts is a priced, visible, PUBLIC Pint Drop:
// a mate's friends-only or anonymous drop never shows here, because this line
// names the person beside the figure and they did not post it for that.
// A block either way removes the mate, through the one live-mate check
// (lib/socialMutual.server.ts). Nothing is added across people
// (ADR 0017); each fact is one person's one price on one day.

import { followStore } from "@/lib/followStore";
import { MATES_PRICES_LIMIT, type MatesPrice } from "@/lib/matesPrices";
import { cleanDrinkMeasure } from "@/lib/drinkMeasure";
import { normalizeViewerHandle } from "@/lib/pintDrops";
import { pintDropsStore, type PintDropDTO } from "@/lib/pintDropsStore";
import { isLiveMutual, type MutualViewer } from "@/lib/socialMutual.server";

/** The verified Social account asking. */
export type MatesPricesViewer = MutualViewer;

export type MatesPricesDependencies = {
  listMutuals(handle: string): Promise<string[]>;
  /** Visible drops at the pub as any stranger reads them, newest first. */
  listVenueDrops(venueId: string): Promise<PintDropDTO[]>;
  /** True only when the pair is still mutual and neither side blocks the other. */
  stillMutual(viewer: MatesPricesViewer, mateHandle: string): Promise<boolean>;
};

const defaultDependencies = (): MatesPricesDependencies => ({
  listMutuals: (handle) => followStore().listMutuals(handle),
  listVenueDrops: (venueId) => pintDropsStore().listVisible(venueId),
  stillMutual: isLiveMutual,
});

/** A drop a mate may be named beside: priced, visible, public and organic. */
function nameableDrop(drop: PintDropDTO): boolean {
  return (
    drop.status === "visible" &&
    (drop.visibility ?? "public") === "public" &&
    drop.provenance !== "demo" &&
    typeof drop.priceGbp === "number" &&
    Number.isFinite(drop.priceGbp) &&
    drop.priceGbp > 0
  );
}

/**
 * Up to three facts, one per mate, each that mate's newest priced public drop
 * at the pub. Empty when the reader has no mutuals or none has logged here.
 */
export async function readMatesPrices(
  viewer: MatesPricesViewer,
  venueId: string,
  dependencies: Partial<MatesPricesDependencies> = {},
): Promise<MatesPrice[]> {
  const deps = { ...defaultDependencies(), ...dependencies };
  const self = normalizeViewerHandle(viewer.handle);
  const mutuals = new Set(
    (await deps.listMutuals(viewer.handle))
      .map(normalizeViewerHandle)
      .filter((handle) => handle && handle !== self),
  );
  if (mutuals.size === 0) return [];

  const drops = (await deps.listVenueDrops(venueId))
    .filter(nameableDrop)
    .filter((drop) => mutuals.has(normalizeViewerHandle(drop.handle)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const prices: MatesPrice[] = [];
  const asked = new Set<string>();
  for (const drop of drops) {
    if (prices.length >= MATES_PRICES_LIMIT) break;
    const handle = normalizeViewerHandle(drop.handle);
    if (asked.has(handle)) continue;
    asked.add(handle);
    if (!(await deps.stillMutual(viewer, handle))) continue;
    prices.push({
      handle,
      priceGbp: drop.priceGbp as number,
      drink: drop.drink,
      measure: cleanDrinkMeasure(drop.measure),
      ...(drop.measureLabel ? { measureLabel: drop.measureLabel } : {}),
      loggedAt: drop.createdAt,
    });
  }
  return prices;
}
