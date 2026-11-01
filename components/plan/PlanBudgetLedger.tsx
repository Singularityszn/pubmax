import { planBudgetLedger, type PlanBudgetLedgerStop } from "@/lib/planBudgetCrawl";

import "./planBudgetLedger.css";

/**
 * The running total under a per-person budget (the £20 crawl, or any budget the
 * reader typed): one listed pint a stop, each with the day it was read, and
 * one line saying whether the total fits. No figure is coloured: over budget
 * is said in words.
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
        Your {ledger.limit} crawl, one pint a stop
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
                <span className="planBudgetLedger__read"> · {row.readLine}</span>
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
