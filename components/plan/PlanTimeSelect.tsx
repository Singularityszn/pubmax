import { planTimeWindowsOff, type PlanAreaTimeFits } from "@/lib/planAreaHours";
import type { NightAreaSlug, NightContext } from "@/lib/nightPlanning";

/**
 * Tune details' Time control. A time the area's listed opening hours cannot
 * meet is disabled, and one line above the control says why.
 */
export default function PlanTimeSelect({ fits, area, stopCount, value, onChange }: {
  fits: PlanAreaTimeFits | null;
  area: NightAreaSlug | null;
  stopCount: number;
  value: NightContext["daypart"];
  onChange: (daypart: NightContext["daypart"]) => void;
}) {
  const { off, line } = planTimeWindowsOff(fits, area, stopCount);
  return (
    <>
      {line ? <p id="plan-context-time-note" className="planComposer__contextNote">{line}</p> : null}
      <label htmlFor="plan-context-time">Time<select id="plan-context-time" aria-describedby={line ? "plan-context-time-note plan-route-status" : "plan-route-status"} value={value} onChange={(event) => onChange(event.target.value as NightContext["daypart"])}>
        <option value="daytime">Daytime</option>
        <option value="after_work" disabled={off.has("after-work")}>After work</option>
        <option value="evening" disabled={off.has("evening")}>Evening</option>
        <option value="late_night" disabled={off.has("late")}>Late night</option>
        <option value="get_home">Get home</option>
      </select></label>
    </>
  );
}
