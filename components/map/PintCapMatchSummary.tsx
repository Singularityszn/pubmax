import { pintCapMatchLines, type PintCapMatches } from "@/lib/pintCapMatches";

import "./pintCapMatchSummary.css";

export default function PintCapMatchSummary({ matches }: { matches?: PintCapMatches | null }) {
  if (!matches || (matches.priced === 0 && matches.unknown === 0)) return null;
  const lines = pintCapMatchLines(matches);
  return (
    <div className="pintCapMatchSummary" role="status">
      <p className="pintCapMatchSummaryPriced">{lines.priced}</p>
      {lines.unknown ? <p>{lines.unknown}</p> : null}
    </div>
  );
}
