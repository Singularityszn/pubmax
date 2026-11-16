import { pintCapMatchLines, type PintCapMatches, type PintCapMatchPart } from "@/lib/pintCapMatches";

import "./pintCapMatchSummary.css";

function renderParts(parts: PintCapMatchPart[]) {
  return parts.map((part, index) =>
    typeof part === "string" ? part : <span key={index} className="pintCapMatchSummaryFigure">{part.figure}</span>,
  );
}

export default function PintCapMatchSummary({ matches }: { matches?: PintCapMatches | null }) {
  if (!matches) return null;
  const lines = pintCapMatchLines(matches);
  return (
    <div className="pintCapMatchSummary" role="status">
      <p className="pintCapMatchSummaryPriced">{renderParts(lines.priced)}</p>
      {lines.unknown ? <p>{renderParts(lines.unknown)}</p> : null}
    </div>
  );
}
