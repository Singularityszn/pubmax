// The streamed form of a typed Pub Pal answer, shared by `/api/pub-pal/chat` and
// `lib/palChatClient.ts`. One JSON event per line (NDJSON):
//
//   {"type":"delta","text":"The cheapest pint"}   more of the answer so far
//   {"type":"reset"}                                 what was shown was a checking line, clear it
//   {"type":"final","body":{...}}                    the whole answer, the same body the JSON path returns
//   {"type":"error","error":"..."}                   the turn failed after the stream began
//
// A caller opts in with `Accept: application/x-ndjson`. Without it the route
// answers one JSON body, as it always has. Cards and proposals travel only in
// `final`, because they exist once the tools have run.

export const PAL_CHAT_STREAM_TYPE = "application/x-ndjson";

export type PalChatStreamEvent =
  | { type: "delta"; text: string }
  | { type: "reset" }
  | { type: "final"; body: Record<string, unknown> }
  | { type: "error"; error: string };

export function encodePalChatStreamEvent(event: PalChatStreamEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export function acceptsPalChatStream(accept: string | null): boolean {
  return (accept ?? "").toLowerCase().includes(PAL_CHAT_STREAM_TYPE);
}

export function isPalChatStreamResponse(response: Response): boolean {
  return (response.headers.get("content-type") ?? "").toLowerCase().includes(PAL_CHAT_STREAM_TYPE);
}

function parseLine(line: string): PalChatStreamEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.type === "delta" && typeof record.text === "string") {
    return { type: "delta", text: record.text };
  }
  if (record.type === "reset") return { type: "reset" };
  if (
    record.type === "final" &&
    record.body &&
    typeof record.body === "object" &&
    !Array.isArray(record.body)
  ) {
    return { type: "final", body: record.body as Record<string, unknown> };
  }
  if (record.type === "error" && typeof record.error === "string") {
    return { type: "error", error: record.error };
  }
  return null;
}

/** Read a streamed answer to its end, calling `onEvent` for each event as it arrives. */
export async function readPalChatStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: PalChatStreamEvent) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  const flush = (line: string) => {
    const event = line.trim() ? parseLine(line) : null;
    if (event) onEvent(event);
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        flush(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        newline = pending.indexOf("\n");
      }
    }
    pending += decoder.decode();
    flush(pending);
  } finally {
    reader.releaseLock();
  }
}
