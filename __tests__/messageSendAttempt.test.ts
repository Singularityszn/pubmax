import { describe, expect, it } from "vitest";

import {
  messageSendPayload,
  retainedMessageSendKey,
  type MessageSendAttempt,
} from "@/lib/messageSendAttempt";

const draft: Parameters<typeof messageSendPayload>[0] = {
  conversationId: "conversation-a",
  senderId: "account-a",
  handle: "alice",
  body: "Meet here",
  attachment: null,
};

function failedAttempt(
  input = draft,
  photo: Uint8Array | null = null,
): MessageSendAttempt {
  return { key: "failed-send", payload: messageSendPayload(input).payload, photo };
}

describe("message send attempt keys", () => {
  it("retains a failed text send and requests a new key without an attempt", () => {
    const previous = failedAttempt();
    expect(retainedMessageSendKey(previous, messageSendPayload({ ...draft }).payload, null)).toBe(previous.key);
    expect(retainedMessageSendKey(null, previous.payload, null)).toBeNull();
  });

  it.each([
    { conversationId: "conversation-b" },
    { senderId: "account-b" },
    { handle: "bob" },
    { body: "Meet elsewhere" },
  ])("requests a new key when the send scope or text changes: %j", (change) => {
    expect(retainedMessageSendKey(failedAttempt(), messageSendPayload({ ...draft, ...change }).payload, null)).toBeNull();
  });

  it.each([
    [{ kind: "venue", venue: { id: "pub-a" } }, { kind: "venue", venue: { id: "pub-b" } }],
    [{ kind: "contact", handle: "alice" }, { kind: "contact", handle: "bob" }],
    [{ kind: "event", planId: "plan-a" }, { kind: "event", planId: "plan-b" }],
    [
      { kind: "poll", poll: { question: "Where?", options: ["Pub", "Bar"] } },
      { kind: "poll", poll: { question: "When?", options: ["Pub", "Bar"] } },
    ],
    [
      { kind: "poll", poll: { question: "Where?", options: ["Pub", "Bar"] } },
      { kind: "poll", poll: { question: "Where?", options: ["Bar", "Pub"] } },
    ],
  ] satisfies Array<[NonNullable<typeof draft.attachment>, NonNullable<typeof draft.attachment>]>)(
    "compares reselected attachments by outgoing values: %j",
    (attachment, changed) => {
      const previous = failedAttempt({ ...draft, attachment });
      const reselected = messageSendPayload({ ...draft, attachment: structuredClone(attachment) });
      expect(retainedMessageSendKey(previous, reselected.payload, null)).toBe(previous.key);
      expect(retainedMessageSendKey(previous, messageSendPayload({ ...draft, attachment: changed }).payload, null)).toBeNull();
      expect(retainedMessageSendKey(previous, messageSendPayload(draft).payload, null)).toBeNull();
    },
  );

  it("ignores venue display metadata when the outgoing venue id is unchanged", () => {
    const original = { kind: "venue" as const, venue: { id: "pub-a", name: "Old name" } };
    const renamed = { kind: "venue" as const, venue: { id: "pub-a", name: "New name" } };
    const previous = failedAttempt({ ...draft, attachment: original });
    expect(retainedMessageSendKey(previous, messageSendPayload({ ...draft, attachment: renamed }).payload, null)).toBe(previous.key);
  });

  it("retains identical photo content and rotates for changed content or media type", () => {
    const photoDraft = { ...draft, attachment: { kind: "photo" as const, file: { type: "image/jpeg" } } };
    const previous = failedAttempt(photoDraft, new Uint8Array([1, 2, 3]));
    expect(retainedMessageSendKey(previous, previous.payload, new Uint8Array([1, 2, 3]))).toBe(previous.key);
    expect(retainedMessageSendKey(previous, previous.payload, new Uint8Array([1, 2, 4]))).toBeNull();
    expect(retainedMessageSendKey(previous, previous.payload, new Uint8Array([1, 2]))).toBeNull();
    expect(retainedMessageSendKey(previous, previous.payload, null)).toBeNull();
    const changedType = messageSendPayload({ ...draft, attachment: { kind: "photo", file: { type: "image/png" } } });
    expect(retainedMessageSendKey(previous, changedType.payload, previous.photo)).toBeNull();
    const textAttempt = failedAttempt();
    expect(retainedMessageSendKey(textAttempt, textAttempt.payload, new Uint8Array())).toBeNull();
  });
});
