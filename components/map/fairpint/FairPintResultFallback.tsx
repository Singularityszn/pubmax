import type { FairPintDrawn } from "@/lib/fairPint";
import FairPintStops, { listedFairPintStops } from "./FairPintStops";
import { Button } from "@/components/ui/button";
import { planningConfidenceLabel } from "@/lib/planIntelligence";

export default function FairPintResultFallback({ last, onBack }: { last: FairPintDrawn; onBack: () => void }) {
  return (
    <section className="fairPintCard fairPintResult fairPintResultFallback" aria-label="Your Pint Line">
      <h2>Your Pint Line</h2>
      <p role="alert">Could not load the plan controls. Your route is still here.</p>
      <FairPintStops stops={listedFairPintStops(last.generated.stops)} />
      <strong>{planningConfidenceLabel(last.generated.planningConfidence.level)}</strong>
      {last.generated.planningConfidence.warnings.map((warning) => <p key={warning}>{warning}</p>)}
      <Button onClick={() => window.location.reload()}>Reload the map</Button>
      <Button variant="ghost" onClick={onBack}>Back</Button>
    </section>
  );
}
