export type MapSplitListInspection<T> =
  | { phase: "following" }
  | { phase: "inspecting" | "returning" | "settling"; view: T; scrollTop: number };

export type MapSplitListInspectionEvent<T> =
  | { type: "opened"; view: T; scrollTop: number }
  | { type: "closed" | "map_idle" | "view_settled" | "released" };

export function transitionMapSplitListInspection<T>(
  state: MapSplitListInspection<T>, event: MapSplitListInspectionEvent<T>,
): MapSplitListInspection<T> {
  switch (event.type) {
    case "opened": return { phase: "inspecting", view: event.view, scrollTop: event.scrollTop };
    case "closed": return state.phase === "inspecting" ? { ...state, phase: "returning" } : state;
    case "map_idle": return state.phase === "returning" ? { ...state, phase: "settling" } : state;
    case "view_settled": return state.phase === "settling" ? { phase: "following" } : state;
    case "released": return state.phase === "following" ? state : { phase: "following" };
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}
