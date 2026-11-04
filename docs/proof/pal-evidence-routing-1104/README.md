# Pub Pal price-evidence routing, 4 November 2026

The original router treated a request for price sources as an unsupported item-price question.
The repair keeps evidence instructions separate from the requested pub or crawl.

The base is `445df3a6bc85f2403f984a5f4a32e3e62d9731ff`.
Product changes are limited to `lib/ask/router.ts`.

## Reproduced request

> Find three quiet pubs in Soho for tonight. Show the source and date for any price you use.

The original executable router returned `UNSUPPORTED_PRICE_COMPARISON` and no tool calls.
Its reply began "I can compare listed pint prices, but not prices for that item yet."
Both HTTP regression tests failed because `toolsUsed` was empty.

The repaired router selects `search_venues` and preserves the original query and limit of three.
Both HTTP handlers return three pub cards instead of the unsupported-item refusal.
The request does not require every pub to have a recorded price.

| Public interface | Before | After |
| --- | --- | --- |
| `routeAskDeterministically` | No tool calls | `search_venues`, limit 3 |
| `POST /api/ask` | No tool selected | Three pub cards |
| `POST /api/pub-pal/chat` | No tool selected | Three pub cards |

## Retained boundaries

The matcher accepts whole source, date and map instructions with a generic price qualifier.
It recognises those instructions before or after a discovery or planning sentence.
An explicit burger or wine price subject remains in the existing price policy.
The tests also retain an unsupported item request beside an otherwise valid evidence instruction.

The HTTP tests execute the real handlers and router.
They use the existing offline network boundary and keyless configuration.
They do not contact a model provider or change a real account.
Provider-backed replies, browser rendering and a production replay remain outside this proof.

## Verification

The original router failed the exact request through both HTTP interfaces.
A separate leading-evidence case failed before its sentence-boundary repair.
The final focused run passed 1,016 tests across three suites.

```sh
node_modules/.bin/vitest run __tests__/askRouter.test.ts __tests__/askRoute.test.ts __tests__/pubPalChatRoute.test.ts --maxWorkers=1
```

The original-router replay restored the repaired source in a `finally` block.
No test changes the router source during normal execution.
