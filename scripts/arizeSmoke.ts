/**
 * Arize AX smoke test: register the production tracing stack and send a
 * handful of test spans to the Pubmaxx project.
 *
 *   (set -a; . <keys file>; set +a; npm run arize:smoke)
 *
 * The OTLP exporter that leaves the process is the real one; only its result
 * callback is observed, so the printed codes are the codes OTLP itself saw.
 * The keys are never printed and never written anywhere.
 */
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";

import {
  ARIZE_TRACES_ENDPOINT,
  arizeProjectName,
  arizeTracingEnabled,
  registerArizeTracing,
  traceArizeModelCall,
  traceArizeModelLoop,
} from "../lib/observability/arize";

/** The real exporter with every OTLP result code captured for the report. */
class ResultRecordingExporter implements SpanExporter {
  private readonly delegate: SpanExporter;
  private readonly codes: number[];

  constructor(delegate: SpanExporter, codes: number[]) {
    this.delegate = delegate;
    this.codes = codes;
  }

  export(
    spans: ReadableSpan[],
    resultCallback: (result: { code: number }) => void,
  ): void {
    this.delegate.export(spans, (result) => {
      this.codes.push(result.code);
      resultCallback(result);
    });
  }

  shutdown(): Promise<void> {
    return this.delegate.shutdown();
  }

  async forceFlush(): Promise<void> {
    await this.delegate.forceFlush?.();
  }
}

const waitFor = async (
  codes: number[],
  wanted: number,
  ceilingMs = 30_000,
): Promise<void> => {
  const started = Date.now();
  while (codes.length < wanted) {
    if (Date.now() - started > ceilingMs) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

async function main(): Promise<void> {
  if (!arizeTracingEnabled()) {
    console.error(
      "arize:smoke: needs ARIZE_API_KEY and ARIZE_SPACE_KEY in the environment.",
    );
    process.exit(1);
  }

  const codes: number[] = [];
  await registerArizeTracing({
    exporter: new ResultRecordingExporter(
      new OTLPTraceExporter({
        url: ARIZE_TRACES_ENDPOINT,
        headers: {
          "arize-api-key": (process.env.ARIZE_API_KEY ?? "").trim(),
          "arize-space-id": (process.env.ARIZE_SPACE_KEY ?? "").trim(),
        },
      }),
      codes,
    ),
  });

  console.log(`arize:smoke: project=${arizeProjectName()}`);

  await traceArizeModelCall({
    route: "smoke/model-call",
    model: "smoke/one-off",
    provider: "arize-smoke",
    prompt: "smoke test prompt with a masked handle @smoke-user",
    call: async (span) => {
      span?.setUsage({ promptTokens: 1, completionTokens: 1, totalTokens: 2 });
      span?.setOutput("smoke test completion");
      return "done";
    },
  });

  await traceArizeModelLoop({
    route: "smoke/agent-loop",
    model: "smoke/one-off",
    provider: "arize-smoke",
    prompt: "smoke agent loop",
    run: async ({ modelRound, toolCall }) => {
      const round = modelRound({ prompt: "smoke round" });
      round?.setUsage({ promptTokens: 2, completionTokens: 3, totalTokens: 5 });
      round?.setOutput("smoke round output");
      round?.end();
      const tool = toolCall({ name: "smoke-tool", input: { kind: "smoke" } });
      tool?.setOutput("smoke tool output");
      tool?.end();
      return "done";
    },
  });

  // Four spans leave (model call, agent, round, tool), one OTLP batch each.
  await waitFor(codes, 4);

  let failures = 0;
  for (const code of codes) {
    console.log(`arize:smoke: OTLP exporter result code ${code}`);
    if (code !== 0) failures += 1;
  }
  if (codes.length === 0) {
    console.log("arize:smoke: no OTLP batch reported within the wait window.");
    process.exit(1);
  }
  if (failures > 0) {
    console.error(`arize:smoke: FAILED (${failures} of ${codes.length}).`);
    process.exit(1);
  }
  console.log(`arize:smoke: OK (${codes.length} batches, all result code 0).`);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(`arize:smoke: ${(error as Error).message}`);
  process.exit(1);
});
