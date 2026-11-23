import { priceSourceOf } from "@/lib/priceSourceLink";
import { oldListedPriceLine, type OldListedPrice } from "@/lib/priceTier";

/**
 * An expired listed price, printed only with its month and who listed it
 * (lib/priceTier.ts `oldListedPriceLine`). It sits under the current answer, an
 * estimate or "no price", and never takes its place.
 */
export default function OldListedPriceNote({ old, className }: { old: OldListedPrice | null; className?: string }) {
  if (!old) return null;
  const source = priceSourceOf(old.publisher, old.sourceUrl);
  return (
    <small className={className} data-price-age="old">
      Old price {oldListedPriceLine(old)}.
      {source.kind === "missing" ? null : (
        <>
          {" "}Listed by{" "}
          {source.kind === "link" ? (
            <a className="priceSourceLink" href={source.href} target="_blank" rel="noopener noreferrer">{source.label}</a>
          ) : source.label}.
        </>
      )}
    </small>
  );
}
