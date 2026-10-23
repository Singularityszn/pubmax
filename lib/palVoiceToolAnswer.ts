import { isAskToolName } from "@/lib/ask/types";
import type { PalAnswer } from "@/lib/palChat";
import type { AskProposal } from "@/lib/ask/types";
import { palChatResultFromBody } from "@/lib/palChatClient";

/** Read display facts from the webhook result, never from the agent's speech. */
export function palVoiceToolAnswer(event: unknown): (PalAnswer & { proposals: AskProposal[]; tool: string }) | null {
  if (!event || typeof event !== "object") return null;
  const value = event as Record<string, unknown>;
  if (typeof value.tool_name !== "string" || (!isAskToolName(value.tool_name) && value.tool_name !== "propose_memory")
    || value.is_error !== false || value.is_called !== true || value.truncated === true
    || typeof value.full_tool_result !== "string" || value.full_tool_result.length > 128_000) return null;
  try {
    const body = JSON.parse(value.full_tool_result) as { requestedTool?: unknown; result?: Record<string, unknown> };
    const result = body?.result;
    if (!result || result.ok !== true || typeof result.tool !== "string") return null;
    const memory = value.tool_name === "propose_memory";
    if (memory ? result.tool !== "propose_memory" : !isAskToolName(result.tool)) return null;
    // A fenced server call can choose a different canonical tool. Its receipt
    // must still identify the provider request that produced this result.
    if (result.tool !== value.tool_name && body.requestedTool !== value.tool_name) return null;
    if (body.requestedTool !== undefined && body.requestedTool !== value.tool_name) return null;
    if (!Array.isArray(memory ? result.proposals : result.cards)) return null;
    const answer = palChatResultFromBody({ answer: result.answerHint, cards: memory ? [] : result.cards, proposals: memory ? result.proposals : [], status: "ready" });
    return answer.status === "error" ? null : { ...answer, tool: result.tool };
  } catch {
    return null;
  }
}
