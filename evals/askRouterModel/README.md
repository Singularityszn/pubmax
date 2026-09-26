# Ask router model eval

Live OpenRouter comparison for **first-round tool choice** in the Pub Pal model loop (`probeAskModelToolChoice` in `lib/ask/modelLoop.ts`). Gold labels come from gold rows in `__tests__/fixtures/typesafe/ask-router-cases.json` plus Pal `expectedTools` in `evals/pal/answer-key.json` (queries not already covered).

## Run (costs credits)

```bash
PUBMAXX_ASK_ROUTER_MODEL_EVAL=1 npm run eval:ask-router-models -- --write-scoreboard
```

Requires `OPENROUTER_API_KEY`. CI does not set `PUBMAXX_ASK_ROUTER_MODEL_EVAL`; the harness tests stay offline.

Output: `evals/askRouterModel/scoreboard/latest.md` (git-ignored).
