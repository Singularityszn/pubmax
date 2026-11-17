import { holdFairPintDraw } from "@/lib/mapFirstVisitArrivalGate";
import { startTransition, useEffect, useReducer, useRef, useState } from "react";
import { fairPintRequest, transitionFairPintPlan } from "@/lib/fairPintTransitions";
import type { FairPintGenerated } from "@/lib/fairPint";
import { readApiJson, errorMessageFrom } from "@/lib/apiErrorMessage";
import { priceEvidenceUsableForCeiling } from "@/lib/planRouteEvidence";
let timeModule: typeof import("@/lib/planIntake") | null = null;
let timeReady: Promise<typeof import("@/lib/planIntake")> | null = null;
export function warmFairPintTime() {
  return (timeReady ??= import("@/lib/planIntake")
    .then((module) => {
      timeModule = module;
      return module;
    })
    .catch((error: unknown) => {
      timeReady = null;
      throw error;
    }));
}
export function useFairPintPlan(cityId: string, area: string, onGenerated: (value: FairPintGenerated) => void) {
  const [state, dispatch] = useReducer(transitionFairPintPlan, {
    phase: "dial",
    request: 0,
    last: null,
    error: "",
    retryAt: 0,
  });
  const [start, setStart] = useState("");
  const pending = useRef<AbortController | null>(null),
    sequence = useRef(0);
  const release = useRef<(() => void) | null>(null);
  const watchdog = useRef<number | null>(null);
  const routePending = useRef<{ request: number; generated: FairPintGenerated } | null>(null);
  const releaseDrawing = () => {
    if (watchdog.current !== null) window.clearTimeout(watchdog.current);
    watchdog.current = null;
    release.current?.();
    release.current = null;
  };
  const lineReady = (operationKey: string) => {
    const route = routePending.current;
    if (!route || route.request !== sequence.current || route.generated.operationKey !== operationKey) return;
    routePending.current = null;
    releaseDrawing();
    startTransition(() => onGenerated(route.generated));
  };
  useEffect(
    () => () => {
      pending.current?.abort();
      sequence.current++;
      releaseDrawing();
    },
    [],
  );
  async function draw(pence: number, chosenStart?: string, chosenArea = area) {
    pending.current?.abort();
    routePending.current = null;
    releaseDrawing();
    release.current = holdFairPintDraw();
    watchdog.current = window.setTimeout(() => {
      const route = routePending.current;
      if (route) lineReady(route.generated.operationKey);
      else releaseDrawing();
    }, 2000);
    const controller = new AbortController(),
      request = ++sequence.current;
    pending.current = controller;
    dispatch({ type: "draw", request });
    let waitingForLine = false;
    try {
      const time = timeModule ?? (await warmFairPintTime());
      const input = chosenStart === undefined ? start || time.defaultLondonStartInput() : chosenStart;
      if (chosenStart === undefined && !start) setStart(input);
      const iso = time.resolveFutureLondonStartIso(input, null, new Date());
      if (!iso) throw new Error("Choose a valid future London start time.");
      const response = await fetch("/api/plans/generate", {
        method: "POST",
        priority: "high",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(fairPintRequest(cityId, chosenArea, pence, iso)),
      });
      const body = await readApiJson(response);
      if (sequence.current !== request || controller.signal.aborted) return;
      if (response.status === 429) {
        const seconds = Number(response.headers.get("retry-after"));
        dispatch({
          type: "failed",
          request,
          error: "Too many plans just now. Try again in a minute.",
          retryAt: Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 60) * 1000,
        });
        return;
      }
      if (!response.ok) {
        dispatch({
          type: "failed",
          request,
          error: errorMessageFrom(body, "Could not draw this night. Try again."),
          retryAt: 0,
        });
        return;
      }
      const generated = body as FairPintGenerated;
      if (
        !generated?.groundingProof ||
        !generated.operationKey ||
        generated.stops?.length !== 3 ||
        !generated.inferredContext ||
        !generated.planningConfidence ||
        generated.stops.some(
          (stop) =>
            stop.priceEvidence &&
            priceEvidenceUsableForCeiling(stop.priceEvidence) &&
            stop.priceEvidence.pence! > pence,
        )
      )
        throw new Error("The route details could not be checked. Try again.");
      dispatch({ type: "drawn", request, last: { generated, pence, start: input, startIso: iso } });
      routePending.current = { request, generated };
      if (watchdog.current === null) watchdog.current = window.setTimeout(() => lineReady(generated.operationKey), 2000);
      waitingForLine = true;
    } catch (error) {
      if (controller.signal.aborted || sequence.current !== request) return;
      dispatch({
        type: "failed",
        request,
        error:
          error instanceof Error && /start time|route details/.test(error.message)
            ? error.message
            : "No connection. Your fair pint is saved. Try again.",
        retryAt: 0,
      });
    } finally {
      if (sequence.current === request && !controller.signal.aborted && !waitingForLine) releaseDrawing();
    }
  }
  const [retryReady, setRetryReady] = useState(0);
  useEffect(() => {
    if (!state.retryAt) return;
    const timer = setTimeout(() => setRetryReady(state.retryAt), Math.max(0, state.retryAt - Date.now()));
    return () => clearTimeout(timer);
  }, [state.retryAt]);
  return {
    state,
    start,
    lineReady,
    editStart: (value: string) => {
      pending.current?.abort();
      sequence.current++;
      routePending.current = null;
      releaseDrawing();
      setStart(value);
      if (value === state.last?.start) dispatch({ type: "restore" });
    },
    retrying: state.retryAt > retryReady,
    draw,
    back: () => {
      pending.current?.abort();
      sequence.current++;
      routePending.current = null;
      releaseDrawing();
      dispatch({ type: "back" });
    },
    changeStart: (value: string) => {
      setStart(value);
      return state.last
        ? draw(state.last.pence, value, state.last.generated.inferredContext.nightArea ?? area)
        : Promise.resolve();
    },
  };
}
