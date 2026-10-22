export type FinalVoiceTurn = { at: number; order: number; eventId?: number; text: string };
export type FinalVoiceAudio = { at: number; order: number; eventId?: number; pcm: Buffer };
export type FinalVoiceTool = {
  at: number;
  order: number;
  type: "request" | "response";
  callId?: string;
  name?: string;
  eventId?: number;
  isError?: boolean;
};

export function completedFinalVoiceReply(
  responses: readonly FinalVoiceTurn[],
  audio: readonly FinalVoiceAudio[],
  tools: readonly FinalVoiceTool[],
  spoken: FinalVoiceTurn,
  now: number,
  deadline: number,
  settleMs: number,
): { reply: FinalVoiceTurn; audio: FinalVoiceAudio[] } | undefined {
  if (now >= deadline) throw new Error("the final post-tool answer and matching audio did not complete before the interaction deadline");
  const userEventId = spoken.eventId;
  if (typeof userEventId !== "number" || !Number.isSafeInteger(userEventId)) return undefined;
  const pending = new Map<string, string>();
  let discoveryCompleted = false;
  let lastToolOrder = spoken.order;
  for (const tool of tools.filter((event) => event.order > spoken.order)) {
    if (!tool.callId || typeof tool.eventId !== "number" || !Number.isSafeInteger(tool.eventId) || tool.eventId < userEventId) return undefined;
    lastToolOrder = tool.order;
    if (tool.type === "request") {
      if (!tool.name) return undefined;
      pending.set(tool.callId, tool.name);
    } else {
      const name = pending.get(tool.callId);
      if (!name || tool.name !== name || tool.isError !== false) return undefined;
      pending.delete(tool.callId);
      discoveryCompleted ||= name === "search_venues" || name === "cheapest_pint_near";
    }
  }
  if (pending.size || !discoveryCompleted) return undefined;
  const reply = responses.findLast((turn) => turn.order > lastToolOrder && turn.text.trim() !== "");
  if (!reply || typeof reply.eventId !== "number" || !Number.isSafeInteger(reply.eventId) || reply.eventId < userEventId) return undefined;
  const matchingAudio = audio.filter((chunk) => chunk.order > reply.order && chunk.eventId === reply.eventId);
  const last = matchingAudio.at(-1);
  if (!last || now - last.at < settleMs) return undefined;
  return { reply, audio: matchingAudio };
}
