# Arize AX tracing of model calls

The server sends one trace per model call to [Arize AX](https://arize.com),
under the project **Pubmaxx**, when and only when the two environment keys
below are set. Nothing is sent from local dev, tests, CI or any keyless
deployment: the module `lib/observability/arize.ts` registers nothing when a
key is missing, and the AI SDK stays silent without it.

Everything below is server-side only. No span is created in the browser.

## Environment variables

| Variable | Required | Value |
| --- | --- | --- |
| `ARIZE_API_KEY` | yes | The Arize AX API key (from the onboarding flow or `ax`). |
| `ARIZE_SPACE_KEY` | yes | The Arize space id. Arize's own tooling calls this a space id; this app reads it from `ARIZE_SPACE_KEY` so local `.env.local` and the Vercel project use one name. |
| `ARIZE_PROJECT_NAME` | no | Override of the project name. Defaults to `Pubmaxx`. |

The project name rides the resource attribute `openinference.project.name`, and
the OTLP endpoint is `https://otlp.arize.com/v1/traces` (US). Both keys are
sent as request headers, never as span attributes.

### Production (Vercel)

The captain adds these to the Vercel project (Production and Preview), then
redeploys:

```
ARIZE_API_KEY=<<the Arize AX API key>>
ARIZE_SPACE_KEY=<<the Arize space id>>
```

`ARIZE_PROJECT_NAME` is not needed; the default is already `Pubmaxx`.

`instrumentation.ts` at the repo root is the one entry point Next.js calls,
and it works on the Vercel Node runtime. The module loads its OpenTelemetry
pieces lazily and only when the keys are present, so keyless builds pay two
environment reads and nothing else.

## What is traced

| Route tag (`metadata.route`) | Call site | Span shape |
| --- | --- | --- |
| `ask/model-loop` (default), `api/ask` | `lib/ask/modelLoop.ts` OpenRouter tool loop | one AGENT span, one LLM span per round (input: the messages added since the previous round), one TOOL span per tool call |
| `api/pub-pal/chat` | `lib/ask/runAsk.ts` with `skipModel: true` when ElevenLabs is off | TOOL spans from the deterministic router only; no OpenRouter LLM span |
| `api/heritage` | `lib/heritage.ts` narrations | one LLM span |
| `search-gateway` | `lib/searchProvider.server.ts` AI SDK `generateText` via the gateway | AI SDK spans (`gen_ai.agent.name = search-gateway`) |
| `moderation/avatar` | `lib/profileAvatarModeration.ts` both adapters | one LLM span per moderation call |
| `moderation/social-post` | `lib/socialPostModeration.ts` | one LLM span |

Every span the helpers write carries `llm.model_name`, the route tag under `metadata.route`, the
provider under `metadata.provider`, token counts
(`llm.token_count.prompt` / `completion` / `total`) when the provider reports
them, and latency as the span duration. `metadata` never carries a request
URL, an IP, a handle or an account id: the tag is a static string chosen at
the call site.

### The OpenAI SDK instrumentation

`registerArizeTracing` also hands `registerOTel` an `OpenAIInstrumentation`
from `@arizeai/openinference-instrumentation-openai`, on the same keyed path
and never on the keyless one, so its spans join the provider, the
OpenInference filter and the masking exporter the rest of this module uses.

It patches the `openai` npm SDK on require. **No module in this app imports
that SDK today**: every model call is a raw `fetch` (OpenRouter in the ask
loop, heritage and concierge; `https://api.openai.com/v1/moderations` in the
two moderation adapters), so the instrumentation currently emits nothing and
the `openai` dependency exists only so the patch target resolves. It is here
for the first call site that does adopt the SDK. Do not read the table above
as covering OpenAI SDK calls until one exists.

When one does: its spans carry the SDK's own prompt and completion values.
They are masked for emails and handles by `MaskingSpanExporter`, like AI SDK
spans, and like AI SDK spans they are NOT capped at 2048 characters, because
this module does not write them. Cap or hide them with the instrumentation's
`traceConfig` at that point, not after the first export.

## What is never sent

- **Prompts and completions are masked before export.** Emails become
  `[email]` and handles become `@[handle]`, first when the helper writes the
  attribute and again in `MaskingSpanExporter`, so AI SDK spans this module
  never sees are covered too. The helpers cap the values they write at 2048
  characters. AI SDK span values are masked but not capped.
- **Moderation calls record no input.** The avatar and social-post moderation
  requests carry short-lived signed image URLs; the spans carry only the
  model, route and decision.
- **The keys never appear in a span or a log line.** They ride OTLP headers,
  and a registration failure is logged scrubbed.

## Verifying locally

With real keys in `.env.local`, send a handful of test spans:

```
npm run arize:smoke
```

The script prints the exporter result code for each send (0 is success) and
never prints the keys. Spans appear in the Pubmaxx project in Arize AX.

## Tests

- `__tests__/arizeTracing.test.ts`: activation rules, masking, and that
  nothing registers without the keys.
- `__tests__/arizeTracingRegistration.test.ts`: real registration against a
  capturing exporter: span attributes, token counts, the agent tree, export
  filtering and masking of spans this module never built.
