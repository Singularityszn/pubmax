import { useEffect, useEffectEvent, type ReactNode } from "react";
import type { FairPintGenerated } from "@/lib/fairPint";
import { useFairPintPlan } from "./useFairPintPlan";

export default function FairPintPlanner({ cityId, area, initialArea, pence, onGenerated, children }: {
  cityId: string;
  area: string;
  initialArea: string;
  pence: number;
  onGenerated: (value: FairPintGenerated) => void;
  children: (plan: ReturnType<typeof useFairPintPlan>) => ReactNode;
}) {
  const plan = useFairPintPlan(cityId, area, onGenerated);
  const draw = useEffectEvent(() => { void plan.draw(pence, undefined, initialArea); });
  useEffect(() => { draw(); }, [pence, initialArea]);
  return children(plan);
}
