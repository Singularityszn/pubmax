import { useEffect, useReducer, useRef, useState } from "react";
import { fairPintRequest, transitionFairPintPlan, type FairPintGenerated } from "@/lib/fairPint";
import { readApiJson, errorMessageFrom } from "@/lib/apiErrorMessage";
import { priceEvidenceUsableForCeiling } from "@/lib/planRouteEvidence";
export function useFairPintPlan(cityId: string, area: string, onGenerated: (value: FairPintGenerated) => void) {
  const [state, dispatch] = useReducer(transitionFairPintPlan, { phase: "dial", request: 0, last: null, error: "", retryAt: 0 });
  const [start, setStart] = useState("");
  const pending = useRef<AbortController | null>(null), sequence = useRef(0);
  useEffect(() => () => { pending.current?.abort(); sequence.current++; }, []);
  async function draw(pence: number, chosenStart?: string) {
    pending.current?.abort();
    const controller = new AbortController(), request = ++sequence.current;
    pending.current = controller;
    dispatch({ type: "draw", request });
    try {
      const time = await import("@/lib/planIntake");
      const input = chosenStart === undefined ? start || time.defaultLondonStartInput() : chosenStart;
      if (chosenStart === undefined && !start) setStart(input);
      const iso = time.resolveFutureLondonStartIso(input, null, new Date());
      if (!iso) throw new Error("Choose a valid future London start time.");
      const response = await fetch("/api/plans/generate", { method: "POST", signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify(fairPintRequest(cityId, area, pence, iso)) });
      const body = await readApiJson(response);
      if (sequence.current !== request || controller.signal.aborted) return;
      if (response.status === 429) {
        const seconds = Number(response.headers.get("retry-after"));
        dispatch({ type: "failed", request, error: "Too many plans just now. Try again in a minute.", retryAt: Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 60) * 1000 }); return;
      }
      if (!response.ok) { dispatch({ type: "failed", request, error: errorMessageFrom(body, "Could not draw this night. Try again."), retryAt: 0 }); return; }
      const generated = body as FairPintGenerated;
      if (!generated?.groundingProof || !generated.operationKey || generated.stops?.length !== 3 || !generated.inferredContext || !generated.planningConfidence
        || generated.stops.some((stop) => stop.priceEvidence && priceEvidenceUsableForCeiling(stop.priceEvidence) && stop.priceEvidence.pence! > pence)) throw new Error("The route details could not be checked. Try again.");
      dispatch({ type: "drawn", request, last: { generated, pence, start: input } });
      onGenerated(generated);
    } catch (error) {
      if (controller.signal.aborted || sequence.current !== request) return;
      dispatch({ type: "failed", request, error: error instanceof Error && /start time|route details/.test(error.message) ? error.message : "No connection. Your fair pint is saved. Try again.", retryAt: 0 });
    }
  }
  const [retryReady, setRetryReady] = useState(0);
  useEffect(() => {
    if (!state.retryAt) return;
    const timer = setTimeout(() => setRetryReady(state.retryAt), Math.max(0, state.retryAt - Date.now()));
    return () => clearTimeout(timer);
  }, [state.retryAt]);
  return { state, start, retrying: state.retryAt > retryReady, draw, back: () => { pending.current?.abort(); sequence.current++; dispatch({ type: "back" }); }, changeStart: (value: string) => { setStart(value); return state.last ? draw(state.last.pence, value) : Promise.resolve(); } };
}
