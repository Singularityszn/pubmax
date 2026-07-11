import type { PlanState } from "@/lib/plan";

function startLabel(startTime: string): string {
  const parsed = Date.parse(startTime);
  if (!Number.isFinite(parsed)) return "Time to be confirmed";
  return new Date(parsed).toLocaleTimeString("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function planViewModel(state: PlanState) {
  return {
    title: state.plan.title,
    startLabel: startLabel(state.plan.startTime),
    stops: state.stops.slice().sort((a, b) => a.position - b.position),
    crew: state.crew.slice().sort((a, b) => a.joinedAt.localeCompare(b.joinedAt)),
  };
}

export function shareCopyForPlan(state: PlanState): string {
  const view = planViewModel(state);
  const stopWord = view.stops.length === 1 ? "stop" : "stops";
  return `${view.title} · ${view.stops.length} ${stopWord} · Starts ${view.startLabel} — see the plan and tap I'm in.`;
}
