import type { FairPintPlanState, FairPintPlanEvent, FairPintSaveState, FairPintSaveEvent } from "@/lib/fairPint";

export function fairPintRequest(cityId: string, nightArea: string, pence: number, planStartIso?: string) {
  return {
    cityId,
    query: `maximum £${(pence / 100).toFixed(2)} per pint`,
    context: { nightArea, stopCount: 3 },
    ...(planStartIso ? { planStartIso } : {}),
  };
}

export function transitionFairPintPlan(state: FairPintPlanState, event: FairPintPlanEvent): FairPintPlanState {
  switch (event.type) {
    case "draw":
      return { ...state, phase: "drawing", request: event.request, error: "", retryAt: 0 };
    case "drawn":
      return state.request !== event.request ? state : { ...state, phase: "result", last: event.last, error: "" };
    case "failed":
      return state.request !== event.request
        ? state
        : { ...state, phase: state.last ? "result" : "dial", error: event.error, retryAt: event.retryAt };
    case "restore":
      return state.last ? { ...state, phase: "result", error: "" } : state;
    case "back":
      return { ...state, phase: "dial" };
    default: {
      const never: never = event;
      return never;
    }
  }
}

export function transitionFairPintSave(state: FairPintSaveState, event: FairPintSaveEvent): FairPintSaveState {
  if (event.type === "save") return { phase: "saving", scope: event.scope, notice: "" };
  if (event.scope !== state.scope) return state;
  switch (event.type) {
    case "saved":
      return {
        phase: "locked",
        scope: event.scope,
        planId: event.planId,
        notice: "",
        link: { phase: "loading" },
        share: null,
      };
    case "link":
      return state.phase !== "locked"
        ? state
        : {
            ...state,
            link: event.url ? { phase: "ready", url: event.url } : { phase: "failed" },
            notice: event.url ? "" : "Could not prepare the link. Try again.",
          };
    case "notice":
      return state.phase === "saving"
        ? { phase: "editing", scope: state.scope, notice: event.notice }
        : { ...state, notice: event.notice };
    case "share":
      return state.phase !== "locked" || event.outcome === "cancelled"
        ? state
        : {
            ...state,
            share: event.outcome,
            notice:
              event.outcome === "shared"
                ? "Shared."
                : event.outcome === "whatsapp"
                  ? "Opened WhatsApp."
                  : "Could not open sharing. Copy the link instead.",
          };
    default: {
      const never: never = event;
      return never;
    }
  }
}
