import { formatObservedDate } from "@/lib/dataFreshness";
import type { PlanPintPriceEvidence } from "@/lib/planPintPrice";
import PriceSourceName from "@/components/venue/PriceSourceName";

export default function PlanPintPriceCaption({ evidence }: { evidence: PlanPintPriceEvidence | null }) {
  const source = evidence?.source;
  return (
    <>
      {evidence?.serving === "pint" ? "1 pint" : "Serving size not recorded"}{" · "}
      <PriceSourceName className="planPintSourceLink" data-stop-action label={source?.label} url={source?.url} />{" · "}
      {source?.observedAt ? (
        <>Source read <time dateTime={source.observedAt}>{formatObservedDate(new Date(source.observedAt))}</time></>
      ) : "Source read date unknown"}
    </>
  );
}
