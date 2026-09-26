import { capturePosthogServerEvent } from "@/lib/posthogServer";

const SERVER_DISTINCT_ID = "pubmaxx-server-runtime";

const SAFE_EXCEPTION_TYPES = new Set([
  "AggregateError",
  "Error",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
]);

function safeType(error: unknown): string {
  if (error instanceof Error && SAFE_EXCEPTION_TYPES.has(error.name)) return error.name;
  return "Error";
}

/**
 * Report an unhandled server failure to PostHog error tracking (no message text).
 */
export function capturePosthogServerException(error: unknown, route = "server"): void {
  capturePosthogServerEvent({
    event: "$exception",
    distinctId: SERVER_DISTINCT_ID,
    properties: {
      $exception_list: [{
        type: safeType(error),
        value: `Redacted (${route.slice(0, 40)})`,
      }],
    },
  });
}
