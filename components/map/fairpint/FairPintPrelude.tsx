"use client";

import { MAP_FIRST_VISIT_ARRIVAL_CHANGE_EVENT } from "@/lib/mapFirstVisitArrivalGate";
import FairPintCard from "./FairPintCard";
import { bootFairPintCard, FAIR_PINT_KEY, validFairPint } from "@/lib/fairPint";
import { BUDGET_CHOICES, BUDGET_KEY, budgetCeiling } from "@/lib/onboardingFlow";
import { MAP_FIRST_VISIT_ARRIVAL_KEY } from "@/lib/mapFirstVisitArrival";
import { getCity, type CityId } from "@/lib/cities";
import { nearestNightAreaForViewport } from "@/lib/nightAreas";

const loading = () => ({ phase: "loading" as const });
const noop = () => {};
export default function FairPintPrelude({ cityId }: { cityId: CityId }) {
  const area = nearestNightAreaForViewport(cityId, getCity(cityId).mapView.center);
  if (!area) return null;
  const config = {
    priceKey: FAIR_PINT_KEY,
    budgetKey: BUDGET_KEY,
    dismissalKey: MAP_FIRST_VISIT_ARRIVAL_KEY,
    changeEvent: MAP_FIRST_VISIT_ARRIVAL_CHANGE_EVENT,
    budgets: Object.fromEntries(BUDGET_CHOICES.map(({ id }) => [id, Math.round((budgetCeiling(id) ?? 8) * 100)])),
  };
  const script = `(${bootFairPintCard.toString()})(${JSON.stringify(config).replaceAll("<", "\\u003c")},${validFairPint.toString()})`;
  return (
    <>
      <FairPintCard
        prelude
        start={550}
        area={area.name}
        counts={loading}
        drawCounts={loading}
        located={false}
        locationOff={false}
        offline={false}
        onInput={noop}
        onCommit={noop}
        onLocation={noop}
        onRetry={noop}
        onDraw={noop}
        onClose={noop}
      />
      <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: script }} />
    </>
  );
}
