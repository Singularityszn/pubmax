// The Claude Messages API wire, for tests that hand the shared JSON lane
// (lib/claudeJson.server.ts) a `fetcher` and answer it as the API would.

export const CLAUDE_MESSAGES_URL = "https://api.anthropic.com/v1/messages";

/** One non-streaming Claude answer whose text is `content` (JSON unless already a string). */
export function claudeJsonResponse(
  content: unknown,
  stopReason = "end_turn",
  usage = { input_tokens: 900, output_tokens: 40 },
): Response {
  return new Response(
    JSON.stringify({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-haiku-5-5",
      content: [{ type: "text", text: typeof content === "string" ? content : JSON.stringify(content) }],
      stop_reason: stopReason,
      stop_sequence: null,
      usage,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/** The URL the lane sent one fetch call to. */
export function sentClaudeUrl(call: unknown): string {
  return String((call as [unknown])[0]);
}

/** The request body the lane sent on one fetch call. */
export function sentClaudeBody(call: unknown) {
  const [, init] = call as [string, RequestInit];
  // Left untyped on purpose: the tests read deep into the request they sent.
  return JSON.parse(String(init.body));
}
