import "server-only";
import { PLAN_TIME_WINDOWS, londonDateTimeInputFromIso } from "@/lib/planIntake";
import { PLATFORM_CLIENT_IP_HEADERS, FORWARDED_FOR_HEADER } from "@/lib/clientIpTrust";
import { NightArchitectError, type EveningInput } from "@/lib/chatgpt/server";

/** Adapt the public tool to the existing planner without forwarding account credentials. */
export async function generatePublicEvening(
  input: EveningInput, caller: Request, generate: (request: Request) => Promise<Response>,
): Promise<Record<string, unknown>> {
  const headers = new Headers({ "content-type": "application/json" });
  for (const key of [...PLATFORM_CLIENT_IP_HEADERS, FORWARDED_FOR_HEADER]) {
    const value = caller.headers.get(key);
    if (value) headers.set(key, value);
  }
  const body: Record<string, unknown> = {
    query: input.request, cityId: "london",
    context: { stopCount: 3, ...(input.budgetPence !== undefined ? { budgetLimitPence: input.budgetPence } : {}) },
  };
  if (input.startsAt) {
    const local = londonDateTimeInputFromIso(input.startsAt);
    const clock = local?.slice(11, 16);
    const option = clock ? [...PLAN_TIME_WINDOWS].reverse().find((window) => window.end === null
      ? clock >= window.start || clock < "04:00"
      : clock >= window.start && clock < window.end) : null;
    if (!option) throw new NightArchitectError("Choose a start between 17:30 and 04:00 London time for an evening plan.");
    body.intake = {
      version: 1, area: null, groupSize: null, stopCount: 3,
      budget: input.budgetPence === undefined ? null : { tier: "value", limitPence: input.budgetPence },
      timeWindow: { id: option.id, start: option.start, end: option.end, exactStartIso: new Date(input.startsAt).toISOString() },
      accessibilityNeeds: [],
      skipped: ["area", "group-size", "accessibility", ...(input.budgetPence === undefined ? ["budget"] : [])],
    };
  }
  const request = new Request("https://pubmaxxing.com/api/plans/generate", {
    method: "POST", headers, body: JSON.stringify(body), signal: caller.signal,
  });
  const response = await generate(request);
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
      ? payload.error.slice(0, 500) : "The planner is unavailable. Try again shortly.";
    const refusal = payload as Record<string, unknown>;
    throw new NightArchitectError(message, refusal.retryable === true, typeof refusal.code === "string" ? refusal.code : "REQUEST_UNSUPPORTED");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid planner response");
  return payload as Record<string, unknown>;
}
