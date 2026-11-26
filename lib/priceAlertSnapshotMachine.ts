export type PriceAlertSnapshotState =
  | { phase: "indexing" }
  | { phase: "dispatch" }
  | { phase: "complete" };

export type PriceAlertSnapshotEvent =
  | { type: "observed"; last: boolean }
  | { type: "advanced"; complete: boolean };

export function transitionPriceAlertSnapshot(
  state: PriceAlertSnapshotState,
  event: PriceAlertSnapshotEvent,
): PriceAlertSnapshotState {
  switch (event.type) {
    case "observed":
      return state.phase === "indexing" && event.last ? { phase: "dispatch" } : state;
    case "advanced":
      return event.complete && state.phase !== "complete" ? { phase: "complete" } : state;
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}
