export type FinalVoiceTurn = { at: number; order: number; eventId?: number; text: string };
export type FinalVoiceCompletion = { at: number; order: number; eventId?: number };
export type FinalVoiceAlignment = {
  chars: string[];
  char_durations_ms: number[];
  char_start_times_ms: number[];
};
export type FinalVoiceAudio = {
  at: number;
  order: number;
  eventId?: number;
  pcm: Buffer;
  alignment?: FinalVoiceAlignment;
};
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
  completions: readonly FinalVoiceCompletion[],
  spoken: FinalVoiceTurn,
  now: number,
  deadline: number,
  sampleRate: number | undefined,
): { reply: FinalVoiceTurn; audio: FinalVoiceAudio[]; completion: FinalVoiceCompletion } | undefined {
  if (now >= deadline) throw new Error("the final post-tool answer, matching agent_response_complete and aligned audio capture did not complete before the interaction deadline");
  const pending = new Map<string, string>();
  let discoveryCompleted = false;
  let lastToolOrder = spoken.order;
  for (const tool of tools.filter((event) => event.order > spoken.order)) {
    if (!tool.callId) return undefined;
    lastToolOrder = tool.order;
    if (tool.type === "request") {
      if (!tool.name || pending.has(tool.callId)) return undefined;
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
  if (!reply || !Number.isSafeInteger(reply.eventId) || (reply.eventId ?? -1) < 0) return undefined;
  const completion = completions.findLast((event) => event.order > reply.order && event.eventId === reply.eventId);
  if (!completion || !sampleRate || !Number.isSafeInteger(sampleRate) || sampleRate <= 0) return undefined;
  const streams = new Map<number, FinalVoiceAudio[]>();
  for (const chunk of audio.filter((item) => item.order > lastToolOrder)) {
    if (!Number.isSafeInteger(chunk.eventId) || (chunk.eventId ?? -1) < 0) return undefined;
    const id = chunk.eventId as number;
    streams.set(id, [...(streams.get(id) ?? []), chunk]);
  }
  const normalize = (text: string) => text.replace(/\s+/gu, " ").trim();
  const matches = [...streams.values()].filter((chunks) => {
    let text = "";
    for (const chunk of chunks) {
      const alignment = chunk.alignment;
      if (!alignment || !chunk.pcm.length || chunk.pcm.length % 2 !== 0
        || alignment.chars.length === 0
        || alignment.chars.length !== alignment.char_durations_ms.length
        || alignment.chars.length !== alignment.char_start_times_ms.length) return false;
      let priorEnd = 0;
      for (let index = 0; index < alignment.chars.length; index += 1) {
        const start = alignment.char_start_times_ms[index]!;
        const duration = alignment.char_durations_ms[index]!;
        if (typeof alignment.chars[index] !== "string" || !Number.isFinite(start) || !Number.isFinite(duration)
          || start < priorEnd || duration < 0) return false;
        priorEnd = start + duration;
      }
      if (priorEnd <= 0 || chunk.pcm.length * 1_000 / (sampleRate * 2) < priorEnd) return false;
      text += alignment.chars.join("");
    }
    return normalize(text) === normalize(reply.text);
  });
  if (matches.length !== 1) return undefined;
  return { reply, audio: matches[0]!, completion };
}
