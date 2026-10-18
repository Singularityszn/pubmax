// Next.js server bootstrap hook. Registers Arize AX tracing exactly once
// before any request runs; a no-op without the ARIZE_API_KEY and
// ARIZE_SPACE_KEY environment variables (see lib/observability/arize.ts and
// docs/observability/arize.md). Client-side tracing is deliberately absent:
// `instrumentation-client.ts` stays untouched and nothing here is bundled to
// the browser.
//
// Next also calls `register()` for edge. The OTel / OpenAI instrumentation
// stack imports Node builtins (`path`), so the Arize module must live in
// `instrumentation.node.ts` and load only when NEXT_RUNTIME is nodejs — a
// same-file dynamic import of arize still lands in the Edge/proxy graph and
// 500s every route. Matches `isNonNodeRuntime` in lib/observability/arize.ts.

import type { RequestErrorContext, RequestErrorRequest } from "./lib/requestErrorReport";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { register: registerNode } = await import("./instrumentation.node");
    return registerNode();
  }
}

// Every server error Next captures (a route, a render, an action or the proxy)
// becomes one structured `request.unhandled` line, which is error level and so
// reaches the alert webhook. Without this, a 500 storm left only Next's own
// stderr dump. The Node half also reports it to PostHog error tracking, with
// the route template and no message text, like the process-level hooks.
export async function onRequestError(
  error: unknown,
  request: RequestErrorRequest,
  context: RequestErrorContext,
): Promise<void> {
  try {
    const { reportRequestError } = await import("./lib/requestErrorReport");
    reportRequestError(error, request, context);
    if (process.env.NEXT_RUNTIME === "nodejs") {
      const { captureRequestException } = await import("./instrumentation.node");
      captureRequestException(error, context.routePath);
    }
  } catch {
    /* A reporter that fails must never become a second error. */
  }
}
