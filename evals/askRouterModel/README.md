# Ask router model eval

Live OpenRouter comparison for **first-round tool choice** in the map Ask model
loop (`probeAskModelToolChoice` in `lib/ask/modelLoop.ts`). Production Pal
typed chat uses the ElevenLabs agent, not this loop. Gold labels come from gold
rows in `__tests__/fixtures/typesafe/ask-router-cases.json` plus Pal
`expectedTools` in `evals/pal/answer-key.json` (queries not already covered).

## Run (costs credits)

```bash
PUBMAXX_ASK_ROUTER_MODEL_EVAL=1 npm run eval:ask-router-models -- --write-scoreboard
```

Requires `OPENROUTER_API_KEY`. CI does not set `PUBMAXX_ASK_ROUTER_MODEL_EVAL`; the harness tests stay offline.

Output: `evals/askRouterModel/scoreboard/latest.md` (git-ignored).

## Reading the scoreboard

- **First-tool accuracy** is the headline: the model's first tool call must be an expected tool. Production runs every tool the model calls, so a model that sprays three tools is not rewarded.
- **Any-tool match** is the lenient secondary figure: any picked tool is an expected tool.
- **Errors** are transport failures (429, 5xx, timeout). They are counted apart from wrong answers and excluded from accuracy, latency and cost. A 401 or 402 aborts the run.
- **Unpriced** calls returned no `usage.cost`; cost figures cover priced calls only.

Any row with errors or unpriced calls gets a warning line. Rerun before using it to change `DEFAULT_ASK_MODEL`.
