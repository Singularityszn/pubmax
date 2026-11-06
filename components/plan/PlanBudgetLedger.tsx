import PlanPintPriceCaption from "@/components/plan/PlanPintPriceCaption";
import { planBudgetLedger, type PlanBudgetLedgerStop } from "@/lib/planBudgetCrawl";

import "./planBudgetLedger.css";

/**
 * The running subtotal against the per-person budget, with evidence for each
 * listed price. The summary says in words how the subtotal compares.
 */
export default function PlanBudgetLedger({
  stops,
  limitPence,
}: {
  stops: readonly PlanBudgetLedgerStop[];
  limitPence: number;
}) {
  if (stops.length === 0) return null;
  const ledger = planBudgetLedger(stops, limitPence);
  return (
    <section className="planBudgetLedger" aria-labelledby="plan-budget-ledger-title" data-fits={ledger.fits ?? undefined}>
      <h2 id="plan-budget-ledger-title" className="planBudgetLedger__title">
        Your {ledger.limit} crawl{ledger.allPintServingsKnown ? ", one pint a stop" : ""}
      </h2>
      <ol className="planBudgetLedger__rows">
        {ledger.rows.map((row) => (
          <li key={`${row.position}-${row.venueName}`} className="planBudgetLedger__row">
            <span className="planBudgetLedger__stop">
              {row.position}. {row.venueName}
            </span>
            {row.price ? (
              <span className="planBudgetLedger__price">
                {row.price}
                <span className="planBudgetLedger__read">
                  {" · "}<PlanPintPriceCaption evidence={row.pintPriceEvidence} />
                </span>
              </span>
            ) : (
              <span className="planBudgetLedger__read">No listed pint price</span>
            )}
            {row.runningTotal ? (
              <span className="planBudgetLedger__running">Running total {row.runningTotal}</span>
            ) : null}
          </li>
        ))}
      </ol>
      <p className="planBudgetLedger__summary" role="status">{ledger.summary}</p>
    </section>
  );
}
