import { formatObservedDate } from "@/lib/dataFreshness";
import type { PlanPintPriceEvidence } from "@/lib/planPintPrice";
import "./planPintPriceCaption.css";

export default function PlanPintPriceCaption({ evidence }: { evidence: PlanPintPriceEvidence | null }) {
  const source = evidence?.source;
  return (
    <>
      {evidence?.serving === "pint" ? "1 pint" : "Serving size not recorded"}{" · "}
      {source?.label ? (
        source.url ? (
          <a className="planPintSourceLink" href={source.url} target="_blank" rel="noopener noreferrer" data-stop-action>{source.label}</a>
        ) : <>{source.label} · Link unavailable</>
      ) : "Publisher not recorded"}{" · "}
      {source?.observedAt ? (
        <>Source read <time dateTime={source.observedAt}>{formatObservedDate(new Date(source.observedAt))}</time></>
      ) : "Source read date unknown"}
    </>
  );
}
