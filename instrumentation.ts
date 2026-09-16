// Next.js server bootstrap hook. Registers Arize AX tracing exactly once
// before any request runs; a no-op without the ARIZE_API_KEY and
// ARIZE_SPACE_KEY environment variables (see lib/observability/arize.ts and
// docs/observability/arize.md). Client-side tracing is deliberately absent:
// `instrumentation-client.ts` stays untouched and nothing here is bundled to
// the browser.

import { registerArizeTracing } from "@/lib/observability/arize";

export function register(): Promise<void> {
  return registerArizeTracing();
}
