import type { PlanState } from "@/lib/plan";
import { tryGetNightArea } from "@/lib/nightAreas";
import { discardBody } from "@/lib/responseBody";

export function slidingDoorsGenerationBody(state: PlanState, kind: "shorter-walk" | "plot-twist") {
  const context = state.context!;
  const cityId = context.nightArea ? tryGetNightArea(context.nightArea)?.cityId : null;
  return {
    context: {
      ...context,
      stopCount: state.stops.length,
      ...(kind === "shorter-walk" ? { transportConstraints: [...new Set([...context.transportConstraints, "walking"])] }
        : { atmosphere: [...new Set([...context.atmosphere, "historic"])] }),
    },
    ...(cityId ? { cityId } : {}),
    ...(state.plan.anchorVenueId && state.plan.anchorSource ? {
      anchor: { venueId: state.plan.anchorVenueId, source: state.plan.anchorSource, acceptedArea: null, startsAt: state.plan.startTime },
    } : {}),
  };
}

/** Bound both headers and JSON, including transports that ignore cancellation. */
export async function slidingDoorsJson(url: string, init: RequestInit, parentSignal: AbortSignal): Promise<{ ok: boolean; status: number; body: unknown }> {
  if (parentSignal.aborted) throw new DOMException("Request cancelled.", "AbortError");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel = () => {};
  const deadline = new Promise<never>((_resolve, reject) => {
    cancel = () => { controller.abort(); reject(new DOMException("Request cancelled.", "AbortError")); };
    parentSignal.addEventListener("abort", cancel, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("That request took too long. Try again."));
    }, 8_000);
  });
  const read = async () => {
    const response = await fetch(url, { ...init, cache: "no-store", credentials: "same-origin", signal: controller.signal });
    if (controller.signal.aborted) { discardBody(response); throw new DOMException("Request cancelled.", "AbortError"); }
    const body: unknown = await response.json();
    if (controller.signal.aborted) throw new DOMException("Request cancelled.", "AbortError");
    return { ok: response.ok, status: response.status, body };
  };
  try { return await Promise.race([read(), deadline]); }
  finally { clearTimeout(timer); parentSignal.removeEventListener("abort", cancel); }
}
