import PriceBadge, { PintPriceBadge } from "@/components/PriceBadge";
import { formatGbp } from "@/lib/formatGbp";
import type { PalCard } from "@/lib/palChat";

/** A menu item or unmeasured drink never borrows the pint price comparison. */
export default function PalCardPrice({ card, className }: { card: PalCard; className?: string }) {
  if (typeof card.price !== "number") return null;
  const pint = card.menuEvidence
    ? card.menuEvidence.menu === "drink" && card.menuEvidence.category === "beer" && card.menuEvidence.serving?.trim().toLowerCase() === "pint"
    : card.provenance.kind === "directory";
  return pint ? <PintPriceBadge className={className} priceGbp={card.price} venueId={card.venueId || null} />
    : <PriceBadge className={className}>{formatGbp(card.price)}</PriceBadge>;
}
