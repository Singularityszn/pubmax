import { HOW_WE_ESTIMATE_HREF } from "@/lib/priceTier";

/**
 * The key to a bare "est." figure, once per surface. A trust pill words its
 * own standing ("Estimated") and carries the method link, so it needs none.
 */
export default function EstimateLegend() {
  return (
    <small data-estimate-legend="">
      <a className="priceSourceLink" href={HOW_WE_ESTIMATE_HREF}>est. = estimated</a>
    </small>
  );
}
