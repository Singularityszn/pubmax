import { HOW_WE_ESTIMATE_HREF, HOW_WE_ESTIMATE_LABEL } from "@/lib/priceTier";
import "./trustPill.css";

export default function EstimateLegend({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <small data-estimate-legend="">
        <a className="priceSourceLink" href={HOW_WE_ESTIMATE_HREF}>est. = estimated</a>
      </small>
    );
  }
  return (
    <small className="trustPillBasis" data-estimate-legend="">
      est. means a modelled price, not a quote.{" "}
      <a className="trustPillMethodLink" href={HOW_WE_ESTIMATE_HREF}>{HOW_WE_ESTIMATE_LABEL}</a>
    </small>
  );
}
