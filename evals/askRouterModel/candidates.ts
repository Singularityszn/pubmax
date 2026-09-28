/** Baseline for map Ask first-round tool selection (OpenRouter id). */
export const ASK_ROUTER_MODEL_EVAL_BASELINE = "anthropic/claude-sonnet-4-5";

/** Models compared by `npm run eval:ask-router-models` (order: cheap candidates, then baseline). */
export const ASK_ROUTER_MODEL_EVAL_CANDIDATES = [
  "deepseek/deepseek-v4-flash",
  "openai/gpt-5-nano",
  "google/gemini-2.5-flash-lite",
  ASK_ROUTER_MODEL_EVAL_BASELINE,
] as const;
