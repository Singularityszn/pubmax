import { londonServiceDayBounds } from "@/lib/whatsOn";

/** Let Home and Tonight share recent public reads during navigation. */
export const PUBLIC_TONIGHT_FRESH_MS = 60_000;

/** The current service day's 04:00 rollover, including clock changes. */
export function londonServiceDayRollover(now: number): number {
  const { start } = londonServiceDayBounds(now);
  const previous = londonServiceDayBounds(Date.parse(start) - 24 * 60 * 60_000);
  return Date.parse(previous.end);
}
