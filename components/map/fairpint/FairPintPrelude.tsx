"use client";

import { MAP_FIRST_VISIT_ARRIVAL_KEY, MAP_FIRST_VISIT_ARRIVAL_CHANGE_EVENT } from "@/lib/mapFirstVisitArrivalGate";
import FairPintFrame from "./FairPintFrame";
import { bootFairPintCard, FAIR_PINT_KEY, FAIR_PINT_INTENT_PARAMS, FAIR_PINT_PATH_PATTERN, validFairPint } from "@/lib/fairPint";
import { searchHasArrivalParam } from "@/lib/mapArrivalParams";
import { BUDGET_CHOICES, BUDGET_KEY, budgetCeiling } from "@/lib/budgetChoice";

export default function FairPintPrelude({ area, nonce }: { area: string; nonce?: string }) {
  const config = {
    priceKey: FAIR_PINT_KEY,
    budgetKey: BUDGET_KEY,
    dismissalKey: MAP_FIRST_VISIT_ARRIVAL_KEY,
    changeEvent: MAP_FIRST_VISIT_ARRIVAL_CHANGE_EVENT,
    pathPattern: FAIR_PINT_PATH_PATTERN,
    intentKeys: FAIR_PINT_INTENT_PARAMS,
    budgets: Object.fromEntries(BUDGET_CHOICES.map(({ id }) => [id, Math.round((budgetCeiling(id) ?? 8) * 100)])),
  };
  const script = `(${bootFairPintCard.toString()})(${JSON.stringify(config).replaceAll("<", "\\u003c")},${validFairPint.toString()},${searchHasArrivalParam.toString()})`;
  return (
    <>
      <FairPintFrame prelude area={area} figure="£5.50" reason={`Checking prices in ${area}…`} />
      <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: script }} />
    </>
  );
}
