import type { NightReceipt } from "@/lib/nightReceipt";

export type NightReceiptAnswer =
  | { status: "ready"; receipt: NightReceipt | null }
  | { status: "refused" }
  | { status: "unavailable" };

type Scope = { capability: string; request: number; scope: object | null };
type NightReceiptReadState = Scope & (
  | { phase: "hidden" }
  | { phase: "reading"; receipt: NightReceipt | null; claimedDuringRead: boolean; recovering: boolean }
  | { phase: "ready"; receipt: NightReceipt | null }
  | { phase: "refused" }
  | { phase: "unavailable" }
);

export const INITIAL_NIGHT_RECEIPT_READ: NightReceiptReadState = { phase: "hidden", capability: "", request: 0, scope: null };

type NightReceiptReadEvent =
  | { type: "scope"; capability: string; scope: object; host: boolean }
  | { type: "check" }
  | { type: "claimed" }
  | { type: "interrupted"; capability: string; scope: object; request: number }
  | { type: "answer"; capability: string; scope: object; request: number; answer: NightReceiptAnswer };

function begin(state: NightReceiptReadState, capability = state.capability, scope = state.scope): NightReceiptReadState {
  const sameScope = state.capability === capability;
  return {
    phase: "reading", capability, scope, request: state.request + 1,
    receipt: sameScope && (state.phase === "ready" || state.phase === "reading") ? state.receipt : null,
    claimedDuringRead: false,
    recovering: sameScope && (state.phase === "unavailable" || (state.phase === "reading" && state.recovering)),
  };
}

export function nextNightReceiptRead(state: NightReceiptReadState, event: NightReceiptReadEvent): NightReceiptReadState {
  switch (event.type) {
    case "scope":
      return event.host ? begin(state, event.capability, event.scope)
        : { phase: "hidden", capability: event.capability, scope: event.scope, request: state.request + 1 };
    case "check":
      return state.phase === "hidden" || state.phase === "reading" ? state : begin(state);
    case "claimed":
      if (state.phase === "reading") return { ...state, claimedDuringRead: true };
      return state.phase === "refused" || state.phase === "unavailable" ? begin(state) : state;
    case "interrupted":
    case "answer": {
      if (state.phase !== "reading" || state.capability !== event.capability || state.scope !== event.scope || state.request !== event.request) return state;
      if (event.type === "interrupted") return begin(state);
      const scope = { capability: state.capability, scope: state.scope, request: state.request };
      switch (event.answer.status) {
        case "ready":
          return { ...scope, phase: "ready", receipt: event.answer.receipt };
        case "refused":
          return state.claimedDuringRead ? begin(state) : { ...scope, phase: "refused" };
        case "unavailable":
          return { ...scope, phase: "unavailable" };
        default: {
          const unreachable: never = event.answer;
          return unreachable;
        }
      }
    }
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}
