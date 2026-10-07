import { priceBandClass, type PriceBand } from "@/lib/priceBand";
import type { CompactVenueAnchor } from "@/lib/venueAnchorPresentation";

/** The figure, wearing its price band (lib/priceBand.ts) when it has one. */
function Figure({ label, band }: { label: string; band: PriceBand | null }) {
  const className = priceBandClass(band);
  return className ? <span className={className}>{label}</span> : <>{label}</>;
}

export default function CompactVenuePrice({
  priceLabel,
  anchor,
  band = null,
  className,
  provenanceClassName,
}: {
  priceLabel: string;
  anchor: CompactVenueAnchor | null;
  /** The price BAND the figure wears (lib/priceBand.ts); absent keeps it in ink. */
  band?: PriceBand | null;
  className?: string;
  provenanceClassName?: string;
}) {
  if (!anchor) {
    return (
      <span className={className}>
        <Figure label={priceLabel} band={band} />
      </span>
    );
  }

  return (
    <span className={className}>
      <span>
        <span className="compactVenuePriceAnchor">{anchor.label} · </span>
        <Figure label={priceLabel} band={band} />
      </span>
      <small className={provenanceClassName}>
        {anchor.observedLabel} · {anchor.sourceLabel}
      </small>
    </span>
  );
}
