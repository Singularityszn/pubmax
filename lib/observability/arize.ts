// Arize AX tracing for PUBMAXXING server model calls. ONE module, registered
// once from the root `instrumentation.ts` before any request.
//
// WHAT IS TRACED: every paid-lane model call the app makes on the server:
//  - the Vercel AI SDK (`ai` v7) `generateText` calls, bridged by
//    `@ai-sdk/otel` (`registerTelemetry`), and
//  - every direct model HTTP call in `lib/` (OpenRouter chat completions in
//    the ask loop, heritage narrations and concierge intent; the OpenAI
//    omni-moderation and OpenRouter vision calls in the two moderation
//    adapters), wrapped by the `traceArizeModelCall` / `traceArizeModelLoop`
//    helpers below.
// Each span carries the model, token counts (when the provider reports
// them), latency (the span duration), the provider and a static route tag
// under `metadata.route`. `metadata` never holds a request URL, IP, handle or
// account id: the tag is chosen by the caller at the call site.
//
// PRIVACY: no prompt or completion leaves this process unmasked. Emails and
// handles are masked (`maskPersonalData`) both when a helper writes an
// attribute and again in the `MaskingSpanExporter` before anything is sent,
// so the AI SDK's own spans (whose prompts this module never sees) are
// covered too. Moderation spans never carry the signed image URLs they send.
//
// INERT BY DEFAULT: nothing registers and nothing is sent unless BOTH
// `ARIZE_API_KEY` and `ARIZE_SPACE_KEY` are present, so local dev, tests,
// CI and every keyless deployment stay silent. The space key is the Arize
// SPACE ID (Arize's own tooling names it `ARIZE_SPACE_ID`); this app reads it
// from `ARIZE_SPACE_KEY` so one naming convention covers local files and the
// Vercel project. See docs/observability/arize.md for the operator setup.

import { context, SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import {
  INPUT_MIME_TYPE,
  INPUT_VALUE,
  LLM_INVOCATION_PARAMETERS,
  LLM_MODEL_NAME,
  LLM_TOKEN_COUNT_COMPLETION,
  LLM_TOKEN_COUNT_PROMPT,
  LLM_TOKEN_COUNT_TOTAL,
  MimeType,
  OUTPUT_MIME_TYPE,
  OUTPUT_VALUE,
  OpenInferenceSpanKind,
  SEMRESATTRS_PROJECT_NAME,
  SemanticConventions,
  TOOL_NAME,
} from "@arizeai/openinference-semantic-conventions";

/** `openinference.span.kind`: the attribute AX reads to classify a span. */
const OPENINFERENCE_SPAN_KIND = SemanticConventions.OPENINFERENCE_SPAN_KIND;
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";

/** The Arize AX OTLP traces endpoint (US). */
export const ARIZE_TRACES_ENDPOINT = "https://otlp.arize.com/v1/traces";
/** `service.name` for the resource; the AX project rides `openinference.project.name`. */
const ARIZE_SERVICE_NAME = "pubmaxxing";
/** The AX project the captain chose: "Project name : Pubmaxx". */
const DEFAULT_ARIZE_PROJECT_NAME = "Pubmaxx";
/** OTel span attributes are capped by the SDK; keep the masked values under it. */
const MAX_IO_VALUE_LENGTH = 2048;
const TRACER_NAME = "pubmaxx.arize";

/** True when both Arize credentials are present (non-empty). */
export function arizeTracingEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(
    (env.ARIZE_API_KEY ?? "").trim() && (env.ARIZE_SPACE_KEY ?? "").trim(),
  );
}

/** The AX project name spans are routed to; defaults to "Pubmaxx". */
export function arizeProjectName(
  env: Record<string, string | undefined> = process.env,
): string {
  const override = (env.ARIZE_PROJECT_NAME ?? "").trim();
  return override || DEFAULT_ARIZE_PROJECT_NAME;
}

// Masks user-identifying material before any prompt or completion text is
// written to a span. Emails go first so an address is never half-masked as a
// handle; a handle is an `@token` mention, which is how this app renders them.
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const HANDLE_PATTERN = /@([A-Za-z0-9_][A-Za-z0-9_-]{0,30})/g;

/** Mask emails and handles in free text that may carry user personal data. */
export function maskPersonalData(value: string): string {
  if (!value.includes("@")) return value;
  return value
    .replace(EMAIL_PATTERN, "[email]")
    .replace(HANDLE_PATTERN, "@[handle]");
}

function maskedIoValue(value: string): string {
  const masked = maskPersonalData(value);
  if (masked.length <= MAX_IO_VALUE_LENGTH) return masked;
  return `${masked.slice(0, MAX_IO_VALUE_LENGTH)}[truncated]`;
}

function maskAttributesInPlace(
  attributes: Record<string, unknown> | undefined,
): void {
  if (!attributes) return;
  for (const key of Object.keys(attributes)) {
    const value = attributes[key];
    if (typeof value === "string") {
      const masked = maskPersonalData(value);
      if (masked !== value) attributes[key] = masked;
    } else if (Array.isArray(value)) {
      let maskedAny = false;
      const masked = value.map((item) => {
        if (typeof item !== "string") return item;
        maskedAny = true;
        return maskPersonalData(item);
      });
      if (maskedAny) attributes[key] = masked;
    }
  }
}

/** Mask emails and handles across a finished span's attributes and events. */
export function maskSpanPersonalData(span: ReadableSpan): void {
  maskAttributesInPlace(span.attributes);
  for (const event of span.events ?? []) maskAttributesInPlace(event.attributes);
}

type SpanExporterExportCallback = Parameters<SpanExporter["export"]>[1];

/**
 * Wraps a span exporter and masks emails and handles in every string
 * attribute of every span just before it leaves the process. This is the one
 * choke point that also covers spans this module never builds itself (the
 * Vercel AI SDK's own spans).
 */
class MaskingSpanExporter implements SpanExporter {
  constructor(private readonly delegate: SpanExporter) {}

  export(spans: ReadableSpan[], resultCallback: SpanExporterExportCallback): void {
    for (const span of spans) maskSpanPersonalData(span);
    this.delegate.export(spans, resultCallback);
  }

  async shutdown(): Promise<void> {
    await this.delegate.shutdown();
  }

  async forceFlush(): Promise<void> {
    await this.delegate.forceFlush?.();
  }
}

let registration: Promise<void> | undefined;

export type RegisterArizeTracingOptions = {
  /** Environment override (tests). Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** Exporter override (tests). Production builds the OTLP/protobuf exporter. */
  exporter?: SpanExporter;
};

function isNonNodeRuntime(env: Record<string, string | undefined>): boolean {
  // Next also runs `register()` for edge runtimes; the Node-only OTLP
  // exporter must never load there.
  return Boolean(env.NEXT_RUNTIME) && env.NEXT_RUNTIME !== "nodejs";
}

function scrubArizeSecrets(message: string): string {
  return message.replace(
    /\bARIZE_[A-Z_]+\s*[:=]\s*["']?[^\s"',&]+/gi,
    (match) => {
      const separator = match.indexOf("=") !== -1 ? "=" : ":";
      const at = match.indexOf(separator);
      return `${match.slice(0, at + 1)}[redacted]`;
    },
  );
}

/**
 * Register the OpenTelemetry provider, the Arize OTLP exporter and the Vercel
 * AI SDK v7 telemetry bridge, once per server process. A no-op (no provider,
 * no exporter, no telemetry bridge) unless both Arize keys are present, and
 * on any non-Node runtime. A registration failure is logged and swallowed:
 * observability must never take the app down.
 */
export function registerArizeTracing(
  options: RegisterArizeTracingOptions = {},
): Promise<void> {
  const env = options.env ?? process.env;
  if (!arizeTracingEnabled(env)) return Promise.resolve();
  if (isNonNodeRuntime(env)) return Promise.resolve();
  // Test mode (an injected exporter) bypasses the once-per-process memo so a
  // process that already registered can still be exercised directly.
  if (!options.exporter && registration) return registration;
  const start = async (): Promise<void> => {
    // Heavy OTel and SDK pieces load only when tracing is on, so a keyless
    // dev server, test worker or CI build pays for two env reads and nothing
    // else. The edge runtime never reaches this import at all.
    const [vercelOtel, { OTLPTraceExporter }, openInference, aiSdk, aiOtel] =
      await Promise.all([
        import("@vercel/otel"),
        import("@opentelemetry/exporter-trace-otlp-proto"),
        import("@arizeai/openinference-vercel"),
        import("ai"),
        import("@ai-sdk/otel"),
      ]);
    const exporter = new MaskingSpanExporter(
      options.exporter ??
        new OTLPTraceExporter({
          url: ARIZE_TRACES_ENDPOINT,
          headers: {
            "arize-api-key": (env.ARIZE_API_KEY ?? "").trim(),
            "arize-space-id": (env.ARIZE_SPACE_KEY ?? "").trim(),
          },
        }),
    );
    vercelOtel.registerOTel({
      serviceName: ARIZE_SERVICE_NAME,
      // Arize rejects spans whose resource carries no project name
      // (service.name alone is not routed), so the project rides the resource.
      attributes: { [SEMRESATTRS_PROJECT_NAME]: arizeProjectName(env) },
      // No HTTP/fetch instrumentation: only AI and manual spans are wanted,
      // and the OpenInference filter below would drop the rest anyway.
      instrumentations: [],
      spanProcessors: [
        // Batched: one OTLP request per flush, not one per span. On Vercel,
        // @vercel/otel flushes when the request's root span ends.
        new openInference.OpenInferenceBatchSpanProcessor({
          exporter,
          // Keep only OpenInference spans (AI SDK spans and this module's)
          // and drop the framework HTTP noise others would emit.
          spanFilter: openInference.isOpenInferenceSpan,
          // Re-root AI spans whose (dropped) parent was an HTTP span.
          reparentOrphanedSpans: true,
        }),
      ],
    });
    // v7 emits nothing until a telemetry integration is registered; this
    // bridges the SDK's telemetry events onto the provider above.
    aiSdk.registerTelemetry(new aiOtel.OpenTelemetry());
  };
  const run = start().catch((error: unknown) => {
    // console.warn, not lib/log: this module runs from the instrumentation file
    // before the logger's env is guaranteed, and it must never break the server.
    console.warn(
      `arize.registration_failed: ${scrubArizeSecrets(
        error instanceof Error ? error.message : String(error),
      )}`,
    );
  });
  if (!options.exporter) registration = run;
  return run;
}

/**
 * Export every buffered span now. Vercel flushes per request on its own; the
 * smoke script and the registration tests call this before they read results.
 */
export async function flushArizeTracing(): Promise<void> {
  const provider = trace.getTracerProvider() as {
    getDelegate?: () => unknown;
    forceFlush?: () => Promise<void>;
  };
  const delegate = (provider.getDelegate?.() ?? provider) as {
    forceFlush?: () => Promise<void>;
  };
  await delegate.forceFlush?.();
}

/** A span handle the call sites fill in: tokens, output, failures. */
export type ArizeModelSpan = {
  setUsage(usage: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  }): void;
  setOutput(text: string): void;
  setError(error: unknown): void;
  end(): void;
};

type ArizeSpanSpec = {
  kind: OpenInferenceSpanKind;
  name: string;
  route: string;
  model?: string;
  provider?: string;
  prompt?: string;
  invocationParameters?: Record<string, unknown>;
  toolName?: string;
};

class ArizeSpanHandle implements ArizeModelSpan {
  /** Internal: the wrapped OTel span (unexported type on purpose). */
  readonly raw: Span;
  private failed = false;

  constructor(raw: Span) {
    this.raw = raw;
  }

  setUsage(usage: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  }): void {
    const prompt = Math.max(0, Math.floor(usage.promptTokens ?? NaN));
    if (Number.isFinite(prompt)) this.raw.setAttribute(LLM_TOKEN_COUNT_PROMPT, prompt);
    const completion = Math.max(0, Math.floor(usage.completionTokens ?? NaN));
    if (Number.isFinite(completion)) {
      this.raw.setAttribute(LLM_TOKEN_COUNT_COMPLETION, completion);
    }
    const total = Math.max(0, Math.floor(usage.totalTokens ?? NaN));
    if (Number.isFinite(total)) this.raw.setAttribute(LLM_TOKEN_COUNT_TOTAL, total);
  }

  setOutput(text: string): void {
    this.raw.setAttribute(OUTPUT_VALUE, maskedIoValue(text));
    this.raw.setAttribute(OUTPUT_MIME_TYPE, MimeType.TEXT);
  }

  setError(error: unknown): void {
    this.failed = true;
    const message = error instanceof Error ? error.message : String(error);
    this.raw.recordException(error instanceof Error ? error : new Error(message));
    this.raw.setStatus({ code: SpanStatusCode.ERROR, message: scrubArizeSecrets(message) });
  }

  end(): void {
    // An OpenInference span with no status reads as a failure in AX, so
    // every span is ended OK unless an error was recorded.
    if (!this.failed) this.raw.setStatus({ code: SpanStatusCode.OK });
    this.raw.end();
  }
}

// Spans this module started. A span only nests under one of these: any other
// active span (the Next.js request span) is dropped by the OpenInference
// filter, and `reparentOrphanedSpans` only re-roots AI SDK spans, so a manual
// span parented to it would reach AX with no trace root.
const ownSpans = new WeakSet<Span>();

function startArizeSpan(spec: ArizeSpanSpec): ArizeSpanHandle | undefined {
  if (!arizeTracingEnabled()) return undefined;
  const attributes: Record<string, string | number> = {
    [OPENINFERENCE_SPAN_KIND]: spec.kind,
    "metadata.route": spec.route,
    ...(spec.provider ? { "metadata.provider": spec.provider } : {}),
    ...(spec.model ? { [LLM_MODEL_NAME]: spec.model } : {}),
    ...(spec.prompt !== undefined
      ? {
          [INPUT_VALUE]: maskedIoValue(spec.prompt),
          [INPUT_MIME_TYPE]: MimeType.TEXT,
        }
      : {}),
    ...(spec.invocationParameters
      ? { [LLM_INVOCATION_PARAMETERS]: JSON.stringify(spec.invocationParameters) }
      : {}),
    ...(spec.toolName ? { [TOOL_NAME]: spec.toolName } : {}),
  };
  const active = trace.getActiveSpan();
  const span = trace.getTracer(TRACER_NAME).startSpan(spec.name, {
    attributes,
    root: !active || !ownSpans.has(active),
  });
  ownSpans.add(span);
  return new ArizeSpanHandle(span);
}

/**
 * Trace one direct model call (one HTTP request to a model provider). The
 * `call` callback receives the span handle (undefined when tracing is off)
 * and fills in usage and output as the provider reports them; every failure
 * path, thrown or returned, ends the span with an ERROR status.
 */
export async function traceArizeModelCall<T>(input: {
  route: string;
  model: string;
  provider?: string;
  prompt?: string;
  invocationParameters?: Record<string, unknown>;
  call: (span: ArizeModelSpan | undefined) => Promise<T>;
}): Promise<T> {
  const span = startArizeSpan({
    kind: OpenInferenceSpanKind.LLM,
    name: `chat ${input.model} ${input.route}`,
    route: input.route,
    model: input.model,
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
    ...(input.invocationParameters ? { invocationParameters: input.invocationParameters } : {}),
  });
  try {
    const result = await input.call(span);
    span?.end();
    return result;
  } catch (error) {
    span?.setError(error);
    span?.end();
    throw error;
  }
}

export type ArizeModelLoopSpans = {
  /** One model round (one HTTP call to the provider). */
  modelRound(round: {
    prompt?: string;
    invocationParameters?: Record<string, unknown>;
  }): ArizeModelSpan | undefined;
  /** One tool execution between rounds. */
  toolCall(tool: { name: string; input?: unknown }): ArizeModelSpan | undefined;
};

/**
 * Trace one bounded agent loop (the ask model loop): an AGENT span around the
 * whole loop, with the LLM rounds and tool executions as children, so AX
 * shows the trajectory and not a flat list of model calls. Off entirely when
 * tracing is disabled; the factories then return undefined handles.
 */
export async function traceArizeModelLoop<T>(input: {
  route: string;
  model: string;
  provider?: string;
  prompt?: string;
  invocationParameters?: Record<string, unknown>;
  run: (spans: ArizeModelLoopSpans) => Promise<T>;
}): Promise<T> {
  if (!arizeTracingEnabled()) {
    return input.run({
      modelRound: () => undefined,
      toolCall: () => undefined,
    });
  }
  const agent = startArizeSpan({
    kind: OpenInferenceSpanKind.AGENT,
    name: `agent ${input.route}`,
    route: input.route,
    model: input.model,
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
    ...(input.invocationParameters
      ? { invocationParameters: input.invocationParameters }
      : {}),
  }) as ArizeSpanHandle;
  try {
    const result = await context.with(
      trace.setSpan(context.active(), agent.raw),
      () =>
        input.run({
          modelRound: (round) =>
            startArizeSpan({
              kind: OpenInferenceSpanKind.LLM,
              name: `chat ${input.model} ${input.route}`,
              route: input.route,
              model: input.model,
              ...(input.provider ? { provider: input.provider } : {}),
              ...(round.prompt !== undefined ? { prompt: round.prompt } : {}),
              ...(round.invocationParameters
                ? { invocationParameters: round.invocationParameters }
                : {}),
            }),
          toolCall: (tool) =>
            startArizeSpan({
              kind: OpenInferenceSpanKind.TOOL,
              name: `tool ${tool.name} ${input.route}`,
              route: input.route,
              model: input.model,
              ...(input.provider ? { provider: input.provider } : {}),
              toolName: tool.name,
              ...(tool.input !== undefined
                ? { prompt: JSON.stringify(tool.input) }
                : {}),
            }),
        }),
    );
    agent.end();
    return result;
  } catch (error) {
    agent.setError(error);
    agent.end();
    throw error;
  }
}
