import dynamic from "next/dynamic";
import CrawlPresentationBoundary from "@/components/wild/CrawlPresentationBoundary";
import FairPintResultFallback from "./FairPintResultFallback";
import { useEffect, useEffectEvent, type ComponentProps, type ReactNode } from "react";
import type { CityId } from "@/lib/cities";
import type { FairPintGenerated } from "@/lib/fairPint";
import { useFairPintPlan } from "./useFairPintPlan";

const FairPintResult = dynamic(() => import("./FairPintResult"));

export default function FairPintPlanner({ cityId, area, initialArea, pence, onGenerated, resultProps, children }: {
  cityId: CityId;
  area: string;
  initialArea: string;
  pence: number;
  onGenerated: (value: FairPintGenerated) => void;
  resultProps: Pick<ComponentProps<typeof FairPintResult>, "typedName" | "onName" | "mobile" | "venues" | "returnFocus" | "onClose" | "onBack">;
  children: (plan: ReturnType<typeof useFairPintPlan>) => ReactNode;
}) {
  const plan = useFairPintPlan(cityId, area, onGenerated);
  const draw = useEffectEvent(() => { void plan.draw(pence, undefined, initialArea); });
  useEffect(() => {
    void import("./FairPintResult").catch(() => {});
    draw();
  }, [pence, initialArea]);
  const back = () => { resultProps.onBack(); plan.back(); };
  if (plan.state.last && plan.state.phase !== "dial") return (
    <CrawlPresentationBoundary key={plan.state.last.generated.operationKey}
      fallback={<FairPintResultFallback last={plan.state.last} onBack={back} onLineReady={plan.lineReady} />}
    >
      <FairPintResult {...resultProps} cityId={cityId}
        last={plan.state.last} start={plan.start} busy={plan.state.phase === "drawing"} error={plan.state.error}
        onLineReady={plan.lineReady} onEditStart={plan.editStart} onStart={plan.changeStart} onBack={back}
      />
    </CrawlPresentationBoundary>
  );
  return children(plan);
}
