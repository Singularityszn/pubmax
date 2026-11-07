"use client";

import { trackEvent } from "@/lib/analytics";
import type { PubComparisonResponse } from "@/lib/pubComparison";
import { comparisonDetour, comparisonMoney, comparisonPubLabel } from "@/lib/pubComparisonPresentation";
import PubComparisonShare from "./PubComparisonShare";

function sourceDate(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Source read date not recorded";
  return `Source read ${new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" })}`;
}

export default function PubComparisonResults({ result }: { result: PubComparisonResponse }) {
  const first = result.venues[0];

  return <section className="pubComparisonResults" aria-labelledby="comparison-result-title">
    <h2 id="comparison-result-title" tabIndex={-1}>Your order, pub by pub</h2>
    <p>These are recorded prices, not a quote for today. Check at the bar.</p>
    {result.completeVenueCount < 2 ? <p>No saving is shown until two pubs have prices for your whole order.</p> : null}
    {result.meetingPoint ? <p>Walks start at {result.meetingPoint.name}. Times use the same walking pace and do not include stops.</p> : null}
    <ol className="pubComparisonResultList">
      {result.venues.map((venue, index) => {
        const detour = first && index > 0 ? comparisonDetour(first, venue) : null;
        return <li key={venue.id} className="pubComparisonResult">
          <h3>{comparisonPubLabel(venue)}</h3>
          <p className="pubComparisonTotal">{venue.totalPence === null
            ? `Known subtotal ${comparisonMoney(venue.knownSubtotalPence)}. Order incomplete.`
            : `Listed order total ${comparisonMoney(venue.totalPence)}`}</p>
          <ul className="pubComparisonEvidence">
            {venue.items.map((item, itemIndex) => <li key={itemIndex}>
              <p>{item.requested.quantity} × {item.requested.drinkLabel}, {item.requested.serving}
                {item.lineTotalPence !== null ? `: ${comparisonMoney(item.lineTotalPence)}` : ""}</p>
              {item.evidence ? <p className="pubComparisonSource">
                {item.evidence.eligible ? "Listed." : "Source record, not counted in this total."} {item.evidence.publisher || "Publisher not recorded"}. {sourceDate(item.evidence.date)}.
                {item.evidence.sourceUrl ? <> <a href={item.evidence.sourceUrl} target="_blank" rel="noopener noreferrer">Read source<span className="sr-only"> for {item.requested.drinkLabel} at {venue.name}</span></a></> : null}
              </p> : null}
              {item.reason ? <p>{item.reason}</p> : null}
            </li>)}
          </ul>
          {venue.walk.status === "routed" ? <p>{venue.walk.minutes} minutes on a walking route.</p>
            : venue.walk.status === "unavailable" ? <p>The walking comparison is unavailable for this pub.</p> : null}
          {detour && first ? <p>Compared with {comparisonPubLabel(first)}: {detour.savingPence === 0 ? "the same listed total"
            : `${comparisonMoney(Math.abs(detour.savingPence))} ${detour.savingPence > 0 ? "less" : "more"}`}, and {detour.extraMinutes === 0 ? "the same walk time"
              : `${Math.abs(detour.extraMinutes)} minutes ${detour.extraMinutes > 0 ? "more" : "less"} walking`}.</p> : null}
          <div className="pubComparisonActions">
            <a href={venue.mapHref} aria-label={`Open this pub to plan: ${comparisonPubLabel(venue)}`} onClick={() => trackEvent("pub_comparison_map_requested")}>Open this pub to plan</a>
            <a href={`/ledger/${encodeURIComponent(venue.id)}`} aria-label={`Read the pub record: ${comparisonPubLabel(venue)}`}>Read the pub record</a>
          </div>
          <p>On the map, keep this pub for your plan. Your comparison order stays here. The planner uses its own drink choices and invitation.</p>
        </li>;
      })}
    </ol>
    <PubComparisonShare venues={result.venues} />
  </section>;
}
