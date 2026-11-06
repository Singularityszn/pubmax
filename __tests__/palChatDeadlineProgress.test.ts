import { describe, expect, it } from "vitest";

import { palChatDeadlineTracker } from "@/lib/palChatDeadlineProgress";

describe("palChatDeadlineTracker", () => {
  it("keeps a milestone's first time and counts recall tool traffic by name only", () => {
    let now = 1_000;
    const tracker = palChatDeadlineTracker(1_000, () => now);
    now = 1_250;
    tracker.mark("socketOpenAtMs");
    now = 1_900;
    tracker.mark("socketOpenAtMs");
    tracker.toolRequest({ type: "agent_tool_request", agent_tool_request: { tool_name: "recall_memories" } });
    tracker.toolRequest({ type: "agent_tool_request", agent_tool_request: { tool_name: "search_venues" } });
    now = 2_400;
    tracker.toolResponse({ type: "agent_tool_response", agent_tool_response: { tool_name: "recall_memories" } });
    tracker.complete(false);

    expect(tracker.snapshot()).toMatchObject({
      socketOpenAtMs: 250,
      toolRequestCount: 2,
      recognizedRecallRequestCount: 1,
      toolResponseCount: 1,
      recognizedRecallResponseCount: 1,
      lastToolResponseAtMs: 1_400,
      completeCount: 1,
      ignoredCompleteCount: 1,
      lastCompleteAtMs: 1_400,
    });
  });

  it("counts reply and tool frames that arrive before the ask is sent, and unknown frames always", () => {
    const tracker = palChatDeadlineTracker(0, () => 0);
    tracker.frame({ type: "agent_response" }, false);
    tracker.frame({ type: "agent_response" }, true);
    tracker.frame({ type: "ping" }, false);
    tracker.frame({ type: "something_new" }, true);
    expect(tracker.snapshot()).toMatchObject({ preSendEventCount: 1, unrecognizedMessageCount: 1 });
  });

  it("hands out a copy, so a logged record cannot change later", () => {
    const tracker = palChatDeadlineTracker(0, () => 0);
    const first = tracker.snapshot();
    tracker.reply();
    expect(first.replyCount).toBe(0);
    expect(tracker.snapshot().replyCount).toBe(1);
  });
});
