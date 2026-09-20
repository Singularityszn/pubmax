// A POLL INSIDE A MESSAGE: the ballot, the counts, and what a result may say.
//
// THE LOAD-BEARING CLAIM is rule 2 of `lib/messagePoll.ts`: counts and the
// reader's OWN answer cross the wire, and no voter is ever named — not to the
// author, not to whoever opened the thread. A result that leaked a handle would
// change what people are willing to answer, and it would do it silently.

import { beforeEach, describe, expect, it } from "vitest";

import {
  cleanPollOptions,
  cleanPollQuestion,
  POLL_MAX_OPTIONS,
  POLL_MIN_OPTIONS,
  POLL_OPTION_MAX,
  POLL_QUESTION_MAX,
  pollOptionLabel,
  pollOptionShare,
  pollResults,
  pollTotalLine,
  readPollOptionIndex,
  readStoredPollOptions,
} from "@/lib/messagePoll";
import {
  __resetMemoryMessages,
  memoryMessagesStore,
} from "@/lib/messagesStore";

beforeEach(() => {
  __resetMemoryMessages();
});

describe("the ballot is cleaned once, at the door", () => {
  it("caps the question and calls nothing a real answer", () => {
    expect(cleanPollQuestion("  Where first?  ")).toBe("Where first?");
    expect(cleanPollQuestion("   ")).toBeNull();
    expect((cleanPollQuestion("x".repeat(400)) ?? "").length).toBe(POLL_QUESTION_MAX);
  });

  it("drops blank rows rather than refusing the ones that were filled in", () => {
    // A composer that offers six boxes and takes three answers must not fail on
    // the three left empty.
    expect(cleanPollOptions(["The Harp", "", "  ", "The Blackfriar"])).toEqual([
      "The Harp",
      "The Blackfriar",
    ]);
  });

  it("drops a duplicate, because two identical buttons split one answer", () => {
    expect(cleanPollOptions(["The Harp", "the harp", "The Blackfriar"])).toEqual([
      "The Harp",
      "The Blackfriar",
    ]);
  });

  it("holds the ballot between two and six", () => {
    expect(cleanPollOptions(["only one"])).toBeNull();
    expect(cleanPollOptions([])).toBeNull();
    expect(cleanPollOptions("not a list")).toBeNull();
    const many = Array.from({ length: POLL_MAX_OPTIONS + 1 }, (_, i) => `option ${i}`);
    expect(cleanPollOptions(many)).toBeNull();
    const exact = Array.from({ length: POLL_MAX_OPTIONS }, (_, i) => `option ${i}`);
    expect(cleanPollOptions(exact)).toHaveLength(POLL_MAX_OPTIONS);
    expect((cleanPollOptions(["x".repeat(200), "b"]) ?? [])[0]?.length).toBe(POLL_OPTION_MAX);
  });

  it("reads a stored ballot back, and refuses one that no longer parses", () => {
    expect(readStoredPollOptions(["a", "b"])).toEqual(["a", "b"]);
    expect(readStoredPollOptions('["a","b"]')).toEqual(["a", "b"]);
    expect(readStoredPollOptions("not json")).toBeNull();
    expect(readStoredPollOptions(["a"])).toBeNull();
    expect(readStoredPollOptions(null)).toBeNull();
  });

  it("reads an option index only inside the ballot it was cast against", () => {
    expect(readPollOptionIndex(0, 3)).toBe(0);
    expect(readPollOptionIndex(2, 3)).toBe(2);
    expect(readPollOptionIndex(3, 3)).toBeNull();
    expect(readPollOptionIndex(-1, 3)).toBeNull();
    expect(readPollOptionIndex(1.5, 3)).toBeNull();
    expect(readPollOptionIndex("1", 3)).toBeNull();
  });
});

describe("a result is counts and the reader's own answer, and nothing else", () => {
  const options = ["The Harp", "The Blackfriar"] as const;
  const votes = new Map([
    ["ken", 0],
    ["sam", 1],
    ["jen", 1],
  ]);

  it("folds the votes into counts", () => {
    const view = pollResults("Where first?", options, votes, "ken");
    expect(view.options).toEqual([
      { index: 0, label: "The Harp", votes: 1 },
      { index: 1, label: "The Blackfriar", votes: 2 },
    ]);
    expect(view.totalVotes).toBe(3);
  });

  it("names NOBODY, and answers only about the reader who asked", () => {
    const mine = pollResults("Where first?", options, votes, "sam");
    expect(mine.viewerOptionIndex).toBe(1);
    const theirs = pollResults("Where first?", options, votes, "mallory");
    expect(theirs.viewerOptionIndex).toBeNull();
    // The whole serialized answer, not the fields somebody remembered to check:
    // no voter's handle may appear anywhere in it.
    const serialized = JSON.stringify(mine);
    for (const handle of votes.keys()) {
      expect(serialized).not.toContain(handle);
    }
  });

  it("ignores a vote for an option the ballot does not carry", () => {
    const view = pollResults("Where?", options, new Map([["ken", 7]]), "ken");
    expect(view.totalVotes).toBe(0);
    expect(view.viewerOptionIndex).toBeNull();
  });

  it("says nothing about a share until somebody has answered", () => {
    expect(pollOptionShare(0, 0)).toBe(0);
    expect(pollOptionShare(2, 3)).toBe(67);
    expect(pollTotalLine(0)).toBe("No answers yet");
    expect(pollTotalLine(1)).toBe("1 answer");
    expect(pollTotalLine(4)).toBe("4 answers");
    expect(pollOptionLabel({ index: 0, label: "The Harp", votes: 0 }, 0)).toBe("The Harp");
    expect(pollOptionLabel({ index: 0, label: "The Harp", votes: 1 }, 2)).toBe(
      "The Harp. 1 of 2, 50 per cent",
    );
  });
});

describe("the store keeps one vote per person, and only from a participant", () => {
  const openPoll = async () => {
    const id = (await memoryMessagesStore.openConversation("ken", "sam"))!;
    const sent = await memoryMessagesStore.send(id, "ken", "", {
      kind: "poll",
      question: "Where first?",
      options: ["The Harp", "The Blackfriar"],
    });
    return { id, messageId: sent!.message.id };
  };

  it("carries the ballot with no counts until somebody answers", async () => {
    const { id, messageId } = await openPoll();
    const thread = await memoryMessagesStore.listMessages(id, "sam");
    const attachment = thread?.[0]?.attachment;
    expect(attachment?.kind).toBe("poll");
    expect(attachment?.kind === "poll" && attachment.poll.totalVotes).toBe(0);
    expect(attachment?.kind === "poll" && attachment.poll.viewerOptionIndex).toBeNull();
    expect(messageId).toBeTruthy();
  });

  it("records an answer and reads it back per viewer", async () => {
    const { id, messageId } = await openPoll();
    const answered = await memoryMessagesStore.votePoll(id, messageId, "sam", 1);
    expect(answered?.totalVotes).toBe(1);
    expect(answered?.viewerOptionIndex).toBe(1);
    // The SENDER sees the count and not who cast it.
    const asKen = await memoryMessagesStore.listMessages(id, "ken");
    const attachment = asKen?.[0]?.attachment;
    expect(attachment?.kind === "poll" && attachment.poll.totalVotes).toBe(1);
    expect(attachment?.kind === "poll" && attachment.poll.viewerOptionIndex).toBeNull();
  });

  it("REPLACES rather than adds when somebody changes their mind", async () => {
    const { id, messageId } = await openPoll();
    await memoryMessagesStore.votePoll(id, messageId, "sam", 0);
    const changed = await memoryMessagesStore.votePoll(id, messageId, "sam", 1);
    expect(changed?.totalVotes).toBe(1);
    expect(changed?.options.map((o) => o.votes)).toEqual([0, 1]);
  });

  it("refuses an outsider, an option outside the ballot and a message that is not a poll", async () => {
    const { id, messageId } = await openPoll();
    await expect(memoryMessagesStore.votePoll(id, messageId, "mallory", 0)).resolves.toBeNull();
    await expect(memoryMessagesStore.votePoll(id, messageId, "sam", 9)).resolves.toBeNull();
    await expect(memoryMessagesStore.votePoll(id, messageId, "sam", -1)).resolves.toBeNull();
    const words = await memoryMessagesStore.send(id, "ken", "just words");
    await expect(
      memoryMessagesStore.votePoll(id, words!.message.id, "sam", 0),
    ).resolves.toBeNull();
  });

  it("previews a poll message in the inbox as a poll, never a blank row", async () => {
    const { id } = await openPoll();
    const inbox = await memoryMessagesStore.listConversations("sam");
    expect(inbox.conversations.find((c) => c.id === id)?.lastBody).toBe("Poll");
  });

  it("keeps the floor and ceiling in lockstep with migration 0156", () => {
    expect(POLL_MIN_OPTIONS).toBe(2);
    expect(POLL_MAX_OPTIONS).toBe(6);
    expect(POLL_QUESTION_MAX).toBe(120);
    expect(POLL_OPTION_MAX).toBe(60);
  });
});
