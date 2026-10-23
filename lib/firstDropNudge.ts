// First-drop nudge (Cycle-8 item 3) — turning unpriced venues into
// contribution invitations. Strategic finding (Cycle 6): pubs don't publish
// prices, so crowdsourced Pint Drops are the moat; the 658 unpriced outer
// venues are the target list. On a venue with NO price on record, the overview
// price area becomes an honest, dry, London-toned invitation to log the first
// drop instead of rendering nothing.
//
// This module is the pure gate + copy layer so the render component stays a
// thin presentational shell and the logic is unit-testable without a DOM.

import type { Venue } from "@/lib/venues";
import {
  venuePriceLane,
  venueSourcedPrice,
  type ProvisionalPriceInput,
  type VenueBundlePrices,
} from "@/lib/venuePriceLane";
import type { TabKey } from "@/lib/venueInspectorTabs";
import { LOG_PRICE_DOOR_LABEL } from "@/lib/pintTrust";

/**
 * A venue is "unpriced" - and so a first-drop candidate - when the overview
 * price area has no lane to render: no live community contributor price, no
 * sourced first-party price, no listed bundle price, no in-window pint report,
 * no baseline dataset price, no modelled estimate and no anchor claim. One
 * drinker's report is a price, so a pub holding one is never invited to log its
 * first.
 *
 * The ordering itself lives in `lib/venuePriceLane.ts`, which the overview tab
 * renders from, so the gate cannot drift away from the branch it is meant to
 * fill (#1413). It has no dependency on the unpriced-pin work (#315): it gates
 * purely on the venue's own price fields, so it works wherever an unpriced
 * venue renders.
 */
export function isVenueUnpriced(
  venue: Venue,
  latestContributorPrice: number | null | undefined,
  bundle: VenueBundlePrices = {},
  provisional?: ProvisionalPriceInput | null,
): boolean {
  return (
    venuePriceLane(
      venue,
      latestContributorPrice,
      venueSourcedPrice(venue),
      bundle,
      provisional,
    ) === null
  );
}

export type FirstDropCopy = {
  /** The single dry line shown in the price area. One line — never a banner. */
  line: string;
  /** The label of the one price door, read from its owner (lib/pintTrust.ts). */
  cta: string;
};

// Dry, London, zero begging. One line + CTA per the Cycle-8 tone brief. Variants
// so the nudge doesn't read as a templated string when a user pans across a
// cluster of unpriced outer pubs. Selection is deterministic per venue (below)
// so the same pub always speaks the same way — no reshuffling on re-render.
const FIRST_DROP_VARIANTS: readonly [FirstDropCopy, ...FirstDropCopy[]] = [
  { line: "No pint price logged here yet. Be the first.", cta: LOG_PRICE_DOOR_LABEL },
  { line: "Nobody has logged a pint here. Yours can mark the pin.", cta: LOG_PRICE_DOOR_LABEL },
  { line: "No pint on record here. A dated log starts the trust path.", cta: LOG_PRICE_DOOR_LABEL },
  { line: "Prices here: none. Log one so mates can corroborate it.", cta: LOG_PRICE_DOOR_LABEL },
];

/**
 * WHAT A FAILED DROP READ MAY SAY (review finding F-8).
 *
 * Every line above states that nobody has logged a price here. That is a claim
 * about the pub, and it may only be made once this pub's own drop read has
 * ANSWERED. `/api/pint-drops` answers 503 whenever its store read throws, so a
 * hiccup used to put "No pint price logged here yet" over a pub holding a
 * confirmed price. This line says the true thing instead, and the one price
 * door still rides beside it, so the reader is not left at a dead end.
 */
export const DROP_READ_UNAVAILABLE_LINE =
  "We could not read this pub’s logged prices.";

/**
 * Reject absence wording after a failed drop read. This guard does not test
 * readiness. Pub surfaces hold pending reads through `venuePriceFallbackPending`
 * before they reach the nudge.
 */
export function firstDropNudgeMayClaimAbsence(
  dropReadStatus: "idle" | "ready" | "unavailable" = "idle",
): boolean {
  return dropReadStatus !== "unavailable";
}

/** Stable non-negative hash of a venue id — deterministic variant selection. */
function hashVenueId(venueId: string): number {
  let hash = 0;
  for (let i = 0; i < venueId.length; i += 1) {
    hash = (hash * 31 + venueId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Pick the first-drop copy for a venue. Deterministic by venue id so a given
 * pub always shows the same line (no flicker between renders), while the wider
 * unpriced set reads with variety rather than one repeated string.
 */
export function firstDropNudgeCopy(venueId: string): FirstDropCopy {
  const index = hashVenueId(venueId) % FIRST_DROP_VARIANTS.length;
  return FIRST_DROP_VARIANTS[index] ?? FIRST_DROP_VARIANTS[0];
}

/**
 * The composer-prefill intent the nudge CTA fires. The existing Pint Drop
 * composer is prefilled-for-this-venue purely by rendering on the Pints tab
 * with this venue's id (the composer loads its per-venue draft from venueId),
 * so "prefill" here is: switch to the Pints tab and open the composer for this
 * venue. Returned as a plain object so the wiring is unit-testable.
 */
export type FirstDropComposerIntent = {
  venueId: string;
  tab: TabKey;
  openComposer: true;
};

export function firstDropComposerIntent(venueId: string): FirstDropComposerIntent {
  return { venueId, tab: "pints", openComposer: true };
}
