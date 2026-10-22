import { expect, it } from "vitest";
import {
  completedFinalVoiceReply,
  type FinalVoiceAudio,
  type FinalVoiceTool,
  type FinalVoiceTurn,
} from "../e2e/helpers/finalVoiceReply";

const spoken: FinalVoiceTurn = { at: 0, order: 1, eventId: 10, text: "Find four pubs in Soho" };
const checking: FinalVoiceTurn = { at: 100, order: 2, eventId: 11, text: "I will check those pubs." };
const answer: FinalVoiceTurn = { at: 5_000, order: 6, eventId: 12, text: "Here are the four Soho pubs." };
const checkingAudio: FinalVoiceAudio = { at: 200, order: 3, eventId: 11, pcm: Buffer.from([1, 0]) };
const answerAudio: FinalVoiceAudio = { at: 5_100, order: 7, eventId: 12, pcm: Buffer.from([2, 0]) };
const request: FinalVoiceTool = { at: 300, order: 4, type: "request", callId: "pubs", name: "search_venues", eventId: 10 };
const result: FinalVoiceTool = { at: 4_900, order: 5, type: "response", callId: "pubs", name: "search_venues", eventId: 10, isError: false };
const read = (responses: FinalVoiceTurn[], audio: FinalVoiceAudio[], tools: FinalVoiceTool[], now: number) =>
  completedFinalVoiceReply(responses, audio, tools, spoken, now, 35_000, 1_500);

it("rejects a checking response across a long tool gap and binds the final answer to its audio", () => {
  expect(read([checking], [checkingAudio], [], 2_000)).toBeUndefined();
  expect(read([checking], [checkingAudio], [request], 4_000)).toBeUndefined();
  expect(read([checking], [checkingAudio], [request, result], 5_000)).toBeUndefined();
  expect(read([checking, answer], [checkingAudio, answerAudio], [request, result], 6_000)).toBeUndefined();
  const unrelatedAudio = { ...checkingAudio, at: 5_200, order: 8 };
  const completed = read([checking, answer], [checkingAudio, answerAudio, unrelatedAudio], [request, result], 7_000);
  expect(completed?.reply).toEqual(answer);
  expect(Buffer.concat(completed!.audio.map((chunk) => chunk.pcm))).toEqual(Buffer.from([2, 0]));
});

it.each(["pending tool", "missing answer", "missing audio", "wrong audio ID"])("fails at the existing deadline for %s", (missing) => {
  const responses = missing === "missing answer" ? [checking] : [checking, answer];
  const audio = missing === "missing audio" ? [checkingAudio]
    : [checkingAudio, { ...answerAudio, eventId: missing === "wrong audio ID" ? 99 : 12 }];
  const tools = missing === "pending tool" ? [request] : [request, result];
  expect(read(responses, audio, tools, 34_999)).toBeUndefined();
  expect(() => read(responses, audio, tools, 35_000)).toThrow("before the interaction deadline");
});

it("invalidates an earlier candidate when a sibling tool starts", () => {
  const next: FinalVoiceTool = { ...request, at: 5_200, order: 8, callId: "map", name: "open_map" };
  expect(read([checking, answer], [answerAudio], [request, result, next], 8_000)).toBeUndefined();
  expect(read([checking, answer], [answerAudio], [request, result, next, { ...next, type: "response", order: 9, isError: false }], 8_000)).toBeUndefined();
});

it("refuses unmatched, failed, stale and unidentified tool events", () => {
  for (const invalid of [
    { ...result, callId: "other" }, { ...result, isError: true },
    { ...result, eventId: 9 }, { ...result, eventId: undefined },
  ]) {
    expect(read([answer], [answerAudio], [request, invalid], 8_000)).toBeUndefined();
  }
});
