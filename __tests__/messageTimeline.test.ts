// How a thread reads as a conversation (lib/messageTimeline.ts).
//
// The thread used to print every row the same way: no day, no time, and an
// underlined Report under every received bubble. These fences hold the four
// readings the module owns: day lines, runs, the one read state, and the
// compact inbox time. Every case pins `now`, so the answers do not move with
// the clock the suite runs under.

import { describe, expect, it } from "vitest";

import type { MessageDTO } from "@/lib/messages";
import {
  buildMessageTimeline,
  handleMonogram,
  inboxTimeLabel,
  MESSAGE_READ_STATE_LABEL,
  MESSAGE_RUN_GAP_MS,
  messageClock,
  messageDayKey,
  messageDayLabel,
  messageReadState,
} from "@/lib/messageTimeline";

// A Saturday evening in London, British Summer Time (UTC+1).
const NOW = new Date("2026-09-05T20:30:00+01:00");

function row(
  id: string,
  senderHandle: string,
  at: string,
  extra: Partial<MessageDTO> = {},
): MessageDTO {
  return {
    id,
    conversationId: "c1",
    senderHandle,
    body: `body ${id}`,
    createdAt: at,
    read: false,
    flagged: false,
    ...extra,
  };
}

describe("the day line", () => {
  it("keys and words a day in London, not in UTC", () => {
    // 23:30 UTC on the 4th is 00:30 on the 5th in London.
    expect(messageDayKey("2026-09-04T23:30:00Z")).toBe("2026-09-05");
    expect(messageDayLabel("2026-09-04T23:30:00Z", NOW)).toBe("Today");
    expect(messageClock("2026-09-04T23:30:00Z")).toBe("00:30");
  });

  it("says Today, Yesterday, then the weekday, then the date", () => {
    expect(messageDayLabel("2026-09-05T09:00:00+01:00", NOW)).toBe("Today");
    expect(messageDayLabel("2026-09-04T23:00:00+01:00", NOW)).toBe("Yesterday");
    expect(messageDayLabel("2026-09-01T12:00:00+01:00", NOW)).toBe("Tuesday");
    expect(messageDayLabel("2026-08-20T12:00:00+01:00", NOW)).toBe("20 Aug");
    expect(messageDayLabel("2025-12-31T12:00:00Z", NOW)).toBe("31 Dec 2025");
  });

  it("answers nothing for a date that does not parse", () => {
    expect(messageDayKey("not a date")).toBe("");
    expect(messageDayLabel("not a date", NOW)).toBe("");
    expect(messageClock("not a date")).toBe("");
  });
});

describe("the inbox time", () => {
  it("is compact and relative inside the day, then names the day", () => {
    expect(inboxTimeLabel("2026-09-05T20:29:40+01:00", NOW)).toBe("now");
    expect(inboxTimeLabel("2026-09-05T20:10:00+01:00", NOW)).toBe("20m");
    expect(inboxTimeLabel("2026-09-05T17:00:00+01:00", NOW)).toBe("3h");
    expect(inboxTimeLabel("2026-09-04T22:00:00+01:00", NOW)).toBe("Yesterday");
    expect(inboxTimeLabel("2026-09-01T12:00:00+01:00", NOW)).toBe("Tue");
    expect(inboxTimeLabel("2026-08-20T12:00:00+01:00", NOW)).toBe("20 Aug");
    expect(inboxTimeLabel("2025-12-31T12:00:00Z", NOW)).toBe("31 Dec 2025");
  });
});

describe("the face", () => {
  it("draws the handle's first letter, in capitals, and a mark for nothing", () => {
    expect(handleMonogram("karansznx")).toBe("K");
    expect(handleMonogram("@maisie")).toBe("M");
    expect(handleMonogram("  tom")).toBe("T");
    expect(handleMonogram("")).toBe("?");
  });
});

describe("the read state", () => {
  it("claims only what the row proves", () => {
    expect(messageReadState({ read: true })).toBe("seen");
    expect(messageReadState({ read: false })).toBe("sent");
    expect(MESSAGE_READ_STATE_LABEL.seen).toBe("Seen");
    expect(MESSAGE_READ_STATE_LABEL.sent).toBe("Sent");
    // Nothing in the store knows a device, so nothing here says Delivered.
    expect(Object.values(MESSAGE_READ_STATE_LABEL)).not.toContain("Delivered");
  });
});

describe("the timeline", () => {
  const messages = [
    row("m1", "them", "2026-09-04T19:00:00+01:00", { read: true }),
    row("m2", "me", "2026-09-04T19:01:00+01:00", { read: true }),
    row("m3", "me", "2026-09-04T19:02:00+01:00", { read: true }),
    // A long pause: same sender, new run.
    row("m4", "me", "2026-09-04T19:40:00+01:00", { read: true }),
    row("m5", "them", "2026-09-05T20:00:00+01:00"),
    row("m6", "them", "2026-09-05T20:01:00+01:00"),
    row("m7", "me", "2026-09-05T20:05:00+01:00"),
  ];

  it("puts one day line before each London day", () => {
    const items = buildMessageTimeline(messages, "me", NOW);
    const days = items.filter((item) => item.kind === "day");
    expect(days.map((day) => day.label)).toEqual(["Yesterday", "Today"]);
    expect(items[0]).toMatchObject({ kind: "day", key: "2026-09-04" });
    const todayAt = items.findIndex((item) => item.kind === "day" && item.key === "2026-09-05");
    expect(items[todayAt + 1]).toMatchObject({ kind: "message", message: { id: "m5" } });
  });

  it("groups consecutive bubbles from one person into a run", () => {
    const items = buildMessageTimeline(messages, "me", NOW);
    const shape = Object.fromEntries(
      items
        .filter((item) => item.kind === "message")
        .map((item) => [item.message.id, [item.first, item.last]]),
    );
    expect(shape).toEqual({
      m1: [true, true],
      m2: [true, false],
      m3: [false, true],
      // The pause past MESSAGE_RUN_GAP_MS opens a new run.
      m4: [true, true],
      m5: [true, false],
      m6: [false, true],
      m7: [true, true],
    });
    expect(MESSAGE_RUN_GAP_MS).toBe(10 * 60 * 1000);
  });

  it("carries the read state on the viewer's own newest message alone", () => {
    const items = buildMessageTimeline(messages, "me", NOW);
    const states = items
      .filter((item) => item.kind === "message")
      .map((item) => [item.message.id, item.readState]);
    expect(states).toEqual([
      ["m1", null],
      ["m2", null],
      ["m3", null],
      ["m4", null],
      ["m5", null],
      ["m6", null],
      ["m7", "sent"],
    ]);
    const seen = buildMessageTimeline(
      [row("a", "me", "2026-09-05T20:05:00+01:00", { read: true })],
      "me",
      NOW,
    );
    expect(seen.at(-1)).toMatchObject({ kind: "message", readState: "seen" });
  });

  it("marks which side each bubble sits on and prints its clock", () => {
    const items = buildMessageTimeline(messages, "me", NOW);
    const mine = items.filter((item) => item.kind === "message" && item.mine);
    expect(mine.map((item) => item.kind === "message" && item.message.id)).toEqual([
      "m2",
      "m3",
      "m4",
      "m7",
    ]);
    expect(items.find((item) => item.kind === "message" && item.message.id === "m5")).toMatchObject({
      clock: "20:00",
    });
  });

  it("answers an empty list with no items at all", () => {
    expect(buildMessageTimeline([], "me", NOW)).toEqual([]);
  });

  it("breaks a run at midnight even inside the gap", () => {
    const items = buildMessageTimeline(
      [
        row("a", "them", "2026-09-04T23:58:00+01:00"),
        row("b", "them", "2026-09-05T00:01:00+01:00"),
      ],
      "me",
      NOW,
    );
    expect(items.map((item) => item.kind)).toEqual(["day", "message", "day", "message"]);
    expect(items[1]).toMatchObject({ first: true, last: true });
    expect(items[3]).toMatchObject({ first: true, last: true });
  });
});
