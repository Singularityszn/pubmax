import { expect, it } from "vitest";
import {
  completedFinalVoiceReply,
  type FinalVoiceAudio,
  type FinalVoiceCompletion,
  type FinalVoiceTool,
  type FinalVoiceTurn,
} from "../e2e/helpers/finalVoiceReply";

const spoken: FinalVoiceTurn = { at: 0, order: 1, eventId: 10, text: "Find four pubs in Soho" };
const checking: FinalVoiceTurn = { at: 100, order: 2, eventId: 11, text: "I will check those pubs." };
const answer: FinalVoiceTurn = { at: 5_000, order: 8, eventId: 12, text: "Here are four Soho pubs." };
const pcm = (text: string, at: number, order: number, eventId = 90): FinalVoiceAudio => ({
  at, order, eventId, pcm: Buffer.alloc(text.length * 20, 1),
  alignment: {
    chars: [...text],
    char_start_times_ms: [...text].map((_, index) => index * 10),
    char_durations_ms: [...text].map(() => 10),
  },
});
const checkingAudio = pcm(checking.text, 200, 3, 80);
const head = pcm("Here are ", 4_950, 7);
const tail = pcm("four Soho pubs.", 7_000, 10);
const request: FinalVoiceTool = { at: 300, order: 5, type: "request", callId: "pubs", name: "search_venues" };
const result: FinalVoiceTool = { at: 4_900, order: 6, type: "response", callId: "pubs", name: "search_venues", isError: false };
const completion: FinalVoiceCompletion = { at: 5_200, order: 9, eventId: 12 };
const read = (
  responses: FinalVoiceTurn[], audio: FinalVoiceAudio[], tools: FinalVoiceTool[],
  completions: FinalVoiceCompletion[] = [], now = 8_000,
) => completedFinalVoiceReply(responses, audio, tools, completions, spoken, now, 35_000, 1_000);

it("rejects checking replies, delayed tools and audio gaps longer than the former silence window", () => {
  expect(read([checking], [checkingAudio], [], [{ at: 250, order: 4, eventId: 11 }])).toBeUndefined();
  expect(read([checking], [checkingAudio], [request])).toBeUndefined();
  expect(read([checking], [checkingAudio], [request, result])).toBeUndefined();
  expect(read([checking, answer], [checkingAudio, head], [request, result], [completion], 6_999)).toBeUndefined();
  expect(read([checking, answer], [checkingAudio, head, tail], [request, result])).toBeUndefined();
  const completed = read([checking, answer], [checkingAudio, head, tail], [request, result], [completion], 7_001);
  expect(completed?.reply).toEqual(answer);
  expect(completed?.completion).toEqual(completion);
  expect(Buffer.concat(completed!.audio.map((chunk) => chunk.pcm))).toEqual(Buffer.concat([head.pcm, tail.pcm]));
});

it.each(["pending tool", "missing answer", "missing audio", "missing completion", "wrong completion ID", "early completion", "missing response ID", "incomplete PCM", "wrong text", "missing alignment"])(
  "fails at the existing deadline for %s", (missing) => {
    const responses = missing === "missing answer" ? [checking]
      : [{ ...answer, eventId: missing === "missing response ID" ? undefined : answer.eventId }];
    const audio = missing === "missing audio" ? [] : [head, {
      ...tail,
      pcm: missing === "incomplete PCM" ? Buffer.from([1, 0]) : tail.pcm,
      alignment: missing === "missing alignment" ? undefined
        : missing === "wrong text" ? pcm("elsewhere", 0, 0).alignment : tail.alignment,
    }];
    const completions = missing === "missing completion" ? [] : [{
      ...completion,
      eventId: missing === "wrong completion ID" ? 999 : completion.eventId,
      order: missing === "early completion" ? 4 : completion.order,
    }];
    const tools = missing === "pending tool" ? [request] : [request, result];
    expect(read(responses, audio, tools, completions, 34_999)).toBeUndefined();
    expect(() => read(responses, audio, tools, completions, 35_000)).toThrow("before the interaction deadline");
  },
);

it("invalidates a candidate when a sibling tool starts or a later reply supersedes it", () => {
  const next: FinalVoiceTool = { ...request, at: 7_100, order: 11, callId: "map", name: "open_map" };
  expect(read([answer], [head, tail], [request, result, next], [completion])).toBeUndefined();
  expect(read([answer], [head, tail], [request, result, next, { ...next, type: "response", order: 12, isError: false }], [completion])).toBeUndefined();
  expect(read([answer, { ...answer, order: 11, eventId: 13 }], [head, tail], [request, result], [completion])).toBeUndefined();
});

it("refuses unmatched and failed tool results without assuming shared event IDs", () => {
  for (const invalid of [{ ...result, callId: "other" }, { ...result, isError: true }]) {
    expect(read([answer], [head, tail], [request, invalid], [completion])).toBeUndefined();
  }
  expect(read([answer], [head, tail], [{ ...request, eventId: 60 }, { ...result, eventId: 61 }], [completion])).toBeDefined();
});
