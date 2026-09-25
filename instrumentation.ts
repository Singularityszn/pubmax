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

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { register: registerNode } = await import("./instrumentation.node");
    return registerNode();
  }
}
