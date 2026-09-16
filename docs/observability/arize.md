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
| `ask/model-loop` (default), `api/ask`, `api/pub-pal/llm` | `lib/ask/modelLoop.ts` OpenRouter tool loop | one AGENT span, one LLM span per round, one TOOL span per tool call |
| `api/heritage` | `lib/heritage.ts` narrations | one LLM span |
| `concierge/intent` | `lib/concierge/intent.ts` intent parsing | one LLM span |
| `search-gateway` | `lib/searchProvider.server.ts` AI SDK `generateText` via the gateway | AI SDK spans (`gen_ai.agent.name = search-gateway`) |
| `moderation/avatar` | `lib/profileAvatarModeration.ts` both adapters | one LLM span per moderation call |
| `moderation/social-post` | `lib/socialPostModeration.ts` | one LLM span |

Every span carries `llm.model_name`, the route tag under `metadata.route`, the
provider under `metadata.provider`, token counts
(`llm.token_count.prompt` / `completion` / `total`) when the provider reports
them, and latency as the span duration. `metadata` never carries a request
URL, an IP, a handle or an account id: the tag is a static string chosen at
the call site.

## What is never sent

- **Prompts and completions are masked before export.** Emails become
  `[email]` and handles become `@[handle]`, first when the helper writes the
  attribute and again in `MaskingSpanExporter`, so AI SDK spans this module
  never sees are covered too. Values are capped at 2048 characters.
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
