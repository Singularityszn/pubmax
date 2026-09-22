import { registerArizeTracing } from "@/lib/observability/arize";

export function registerNodeInstrumentation(): Promise<void> {
  return registerArizeTracing();
}
