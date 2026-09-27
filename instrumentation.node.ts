// Node-only half of the root instrumentation hook. Next compiles
// `instrumentation.ts` for both runtimes; keeping the Arize import here means
// the Edge/proxy bundle never sees `@arizeai/openinference-instrumentation-openai`
// (and its Node `path` dependency). Loaded only when
// `process.env.NEXT_RUNTIME === "nodejs"` from instrumentation.ts.

import { registerArizeTracing } from "@/lib/observability/arize";
import { capturePosthogServerException } from "@/lib/posthog/posthogServerException";

let posthogServerHooksInstalled = false;

function registerPosthogServerHooks(): void {
  if (posthogServerHooksInstalled) return;
  posthogServerHooksInstalled = true;
  process.on("unhandledRejection", (reason) => {
    capturePosthogServerException(reason, "unhandledRejection");
  });
  process.on("uncaughtException", (error) => {
    capturePosthogServerException(error, "uncaughtException");
  });
}

export function register(): Promise<void> {
  registerPosthogServerHooks();
  return registerArizeTracing();
}
