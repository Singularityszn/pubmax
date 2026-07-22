import { recommendCrawlIntercept, summarizeInterceptProgress } from "@/lib/crawlIntercept";
import type { PlanState } from "@/lib/plan";

export const MOBILE_HANDOFF_DEFAULT_ETA = 15;

export type MobilePlanHandoffSummary = {
  startLabel: string;
  stopCount: number;
  crewCount: number;
  progressLabel: string;
  statusLabel: string;
  primaryLabel: string;
  targetStop: {
    venueName: string;
    stopNumber: number;
  } | null;
};

function startLabel(startTime: string): string {
  const parsed = Date.parse(startTime);
  if (!Number.isFinite(parsed)) return "Time TBC";
  return new Date(parsed).toLocaleTimeString("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function pubLabel(count: number): string {
  return `${count} ${count === 1 ? "pub" : "pubs"}`;
}

export function mobilePlanHandoffSummary(state: PlanState): MobilePlanHandoffSummary {
  const progress = summarizeInterceptProgress(state);
  const recommendation = recommendCrawlIntercept(state, MOBILE_HANDOFF_DEFAULT_ETA);
  const completed = state.plan.status === "completed" || Boolean(state.ending);

  const progressLabel = progress.totalStops === 0
    ? "No route stops yet"
    : progress.hasProgress
      ? `${progress.completedStops}/${progress.totalStops} stops checked in`
      : `${pubLabel(progress.totalStops)} from ${startLabel(state.plan.startTime)}`;

  const targetStop = recommendation
    ? {
        venueName: recommendation.stop.venueName,
        stopNumber: recommendation.targetIndex + 1,
      }
    : null;

  return {
    startLabel: startLabel(state.plan.startTime),
    stopCount: progress.totalStops,
    crewCount: state.crew.length,
    progressLabel,
    statusLabel: completed ? "Night wrapped" : progress.hasProgress ? "Crew is moving" : "Ready for tonight",
    primaryLabel: targetStop ? `Catch up at stop ${targetStop.stopNumber}` : "Ask the crew",
    targetStop,
  };
}
