---
name: pubmax-ai-sdk
description: PubMaxxing's conventions for model calls, covering the Vercel AI SDK (`ai` v7 with AI Gateway), the direct OpenRouter calls and TypeSafe. Use when adding or changing any server code that calls a language or vision model, a paid model lane, or model tracing in this repo.
---

# Model calls in PubMaxxing

This repo calls models three ways, and every call runs on the server. The other controls differ by path today. The table under "Controls today" says which path has which. A new call must have all of them, as the rules below say.

## Where each kind lives

| Kind | Example | Notes |
| --- | --- | --- |
| Vercel AI SDK (`ai` v7) | `lib/searchProvider.server.ts` | `generateText` with the `gateway` provider and its `exaSearch` tool. The model is an AI Gateway id such as `openai/gpt-5-nano`. Auth is `AI_GATEWAY_API_KEY` or the Vercel OIDC token. |
| Direct OpenRouter HTTP | `lib/ask/modelLoop.ts`, `lib/heritage.ts` | `fetch` to the chat completions API with `OPENROUTER_API_KEY`. The model comes from `OPENROUTER_MODEL` or a named default. |
| TypeSafe (Jev) | `lib/ai/typesafe.server.ts` | `systemOne` for typed judgments, such as `lib/pubPalLlmFence.ts`. |

Moderation calls are in `lib/profileAvatarModeration.ts` and `lib/socialPostModeration.ts`.

## Controls today

Do not assume that an existing path has a control. Check this table and the code.

| Path | Shared paid budget | Arize trace | Fallback |
| --- | --- | --- | --- |
| Ask (`app/api/ask/route.ts`, `lib/ask/modelLoop.ts`) | Yes, lane `ask` | `traceArizeModelLoop` | Deterministic answer |
| Heritage (`app/api/heritage/route.ts`, `lib/heritage.ts`) | Yes, lane `heritage` | `traceArizeModelCall` | Grounded structured answer |
| AI Gateway search (`lib/searchProvider.server.ts`) | No. It has its own `SEARCH_GATEWAY_MAX_CALLS` cap. | AI SDK spans, only when Arize is registered | Not an answer path |
| Moderation (`lib/profileAvatarModeration.ts`, `lib/socialPostModeration.ts`) | No | `traceArizeModelCall` | Not an answer path |
| TypeSafe app door (`lib/ai/typesafe.server.ts`) | Yes, lane `typesafe` | No. It records timing with `recordTypesafeTiming`. | `null` |
| TypeSafe plain Node (`lib/ai/typesafe.ts`) | No | No | `null` |

## Rules for a new model call

1. Put it in a server-only module. Start the file with `import "server-only";`.
2. Inject the SDK through a dependencies object, as `SearchProviderDependencies` does. Tests pass a fake there instead of calling a provider.
3. Cap the call. Set a timeout, a token limit and a round or call limit.
4. Fail closed. With no key, or after an error, return `null` or the deterministic answer. Never let a model invent a price, an opening time or pub history. This is an anti-goal in the root `AGENTS.md`.
5. Spend the paid budget. A route calls `paidSpendBudgetRefusal(lane)` from `lib/paidSpendBudget.server.ts` after its per-address limiter. A new lane goes in `PAID_SPEND_LANES` in `lib/paidSpendBudget.ts`.
6. Trace it. AI SDK spans reach Arize through `@ai-sdk/otel`, which `registerArizeTracing` in `lib/observability/arize.ts` registers. Wrap a direct HTTP call in `traceArizeModelCall` or `traceArizeModelLoop`. Give it a static `route` tag. Never put a URL, an IP address, a handle or an account id in span metadata.
7. Name a new prompt-text host. If user text goes to a new host, add it to `app/privacy/page.tsx` and to the recipient list in `__tests__/legalPages.test.ts`.

## Runtime notes

- Model tracing loads only in the Node runtime, from `instrumentation.node.ts`. Do not import an OpenTelemetry package in code that the proxy or the edge runtime can reach.
- The app runs with no model keys. Each feature must still answer without them.

## Proof

- Tests: `__tests__/searchProvider.test.ts`, `__tests__/heritage.test.ts`, `__tests__/paidSpendBudget.test.ts`, `__tests__/anonymousPaidRoutes.test.ts`, `__tests__/arizeTracing.test.ts`.
- Tracing setup: `docs/observability/arize.md`.
