import { cleanOutingEventStop, outingEventStopFromRow, type OutingEventStop } from "@/lib/outingEventStop";
import { outingIntentParams, parseOutingIntent, type OutingIntent } from "@/lib/outingIntent";
import type { WhatsOnRow } from "@/lib/whatsOn";

type ContextParams = URLSearchParams | Record<string, string | string[] | undefined>;

function param(params: ContextParams, key: string): string {
  const value = params instanceof URLSearchParams ? params.get(key) : params[key];
  return typeof value === "string" ? value.trim() : Array.isArray(value) ? value[0]?.trim() ?? "" : "";
}

export type OutingShareContext = {
  intent: OutingIntent;
  eventStop: OutingEventStop | null;
  eventPosition: number | null;
  eventSide: "before" | "after" | null;
};

export type ResolvedOutingEventContext = {
  eventStop: OutingEventStop | null;
  verified: boolean;
};

/** Replace caller fields only when server-owned id and source URL both match. */
export function resolveCanonicalOutingEvent(
  eventStop: OutingEventStop | null,
  rows: readonly WhatsOnRow[],
): ResolvedOutingEventContext {
  if (!eventStop) return { eventStop: null, verified: false };
  const canonical = rows.find((row) => row.id === eventStop.id && row.source.url === eventStop.source.url);
  const resolved = canonical ? outingEventStopFromRow(canonical) : null;
  return resolved
    ? { eventStop: resolved, verified: true }
    : { eventStop, verified: false };
}

export function parseOutingShareContext(params: ContextParams): OutingShareContext {
  let eventStop: OutingEventStop | null = null;
  const rawEventStop = param(params, "eventStop");
  if (rawEventStop && rawEventStop.length <= 2_000) {
    try {
      eventStop = cleanOutingEventStop(JSON.parse(rawEventStop));
    } catch {
      eventStop = null;
    }
  }
  if (eventStop) {
    const id = param(params, "eventId");
    const sourceUrl = param(params, "eventSourceUrl");
    const startsAt = param(params, "eventStartsAt");
    const startsDate = param(params, "eventStartsDate");
    const endsAt = param(params, "eventEndsAt");
    const observedAt = param(params, "eventObservedAt");
    const admission = param(params, "admissionGbp");
    if (
      (id && id !== eventStop.id) ||
      (sourceUrl && sourceUrl !== eventStop.source.url) ||
      (startsAt && startsAt !== eventStop.startsAt) ||
      (startsDate && startsDate !== eventStop.startsDate) ||
      (endsAt && endsAt !== eventStop.endsAt) ||
      (observedAt && observedAt !== eventStop.observedAt) ||
      (admission && (eventStop.admissionGbp === null || Number(admission) !== eventStop.admissionGbp))
    ) eventStop = null;
  }
  const rawPosition = param(params, "eventPosition");
  const parsedPosition = /^\d{1,2}$/.test(rawPosition) ? Number(rawPosition) : null;
  const eventPosition = parsedPosition !== null && parsedPosition <= 8 ? parsedPosition : null;
  const rawSide = param(params, "eventSide");
  const eventSide = rawSide === "before" || rawSide === "after" ? rawSide : null;
  return {
    intent: parseOutingIntent(params),
    eventStop,
    eventPosition,
    eventSide,
  };
}

export function outingShareContextParams(context: OutingShareContext): URLSearchParams {
  const params = outingIntentParams(context.intent);
  if (context.eventStop) {
    params.set("eventStop", JSON.stringify(context.eventStop));
    params.set("eventId", context.eventStop.id);
    params.set("eventSourceUrl", context.eventStop.source.url);
    if (context.eventStop.startsAt) params.set("eventStartsAt", context.eventStop.startsAt);
    if (context.eventStop.startsDate) params.set("eventStartsDate", context.eventStop.startsDate);
    if (context.eventStop.endsAt) params.set("eventEndsAt", context.eventStop.endsAt);
    if (context.eventStop.observedAt) params.set("eventObservedAt", context.eventStop.observedAt);
    if (context.eventStop.admissionGbp !== null) params.set("admissionGbp", String(context.eventStop.admissionGbp));
    if (context.eventPosition !== null) params.set("eventPosition", String(context.eventPosition));
    if (context.eventSide) params.set("eventSide", context.eventSide);
  }
  return params;
}

/** Preserve only public outing intent; local-only reminders and arbitrary URL keys never propagate. */
export function preservedOutingShareSearch(search: string, eventPosition?: number): string {
  const context = parseOutingShareContext(new URLSearchParams(search));
  const position = Number.isInteger(eventPosition) && eventPosition! >= 0 && eventPosition! <= 8
    ? eventPosition!
    : context.eventPosition;
  const withPosition = { ...context, eventPosition: context.eventStop ? position : null, eventSide: null };
  return outingShareContextParams(withPosition).toString();
}
