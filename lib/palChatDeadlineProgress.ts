/**
 * What a typed Pub Pal turn had reached when it ran out of time.
 *
 * A deadline failure says only "TIMEOUT", which cannot tell a slow socket from
 * a slow tool or an agent that never answered. This record holds elapsed times,
 * counters and reply eligibility, and nothing else: no ask, no reply text,
 * no frame content, no conversation id, no owner.
 * Times are milliseconds since tracking started.
 * It is attached to the `pub_pal.chat_failed` log line for the deadline stage
 * only.
 */
export type PalChatDeadlineProgress = {
  socketOpenAtMs: number | null;
  metadataAtMs: number | null;
  memoriesReadyAtMs: number | null;
  tasteReadyAtMs: number | null;
  registrationStarted: number;
  registrationReady: number;
  registrationReadyAtMs: number | null;
  sendReturnedAtMs: number | null;
  firstReplyAtMs: number | null;
  /** Known reply and tool frames that arrived before the ask was sent, and so were ignored. */
  preSendEventCount: number;
  parseFailureCount: number;
  unrecognizedMessageCount: number;
  replyCount: number;
  streamDeltaCount: number;
  lastStreamStopAtMs: number | null;
  toolRequestCount: number;
  toolResponseCount: number;
  recognizedRecallRequestCount: number;
  recognizedRecallResponseCount: number;
  lastToolResponseAtMs: number | null;
  completeCount: number;
  /** Turn-complete frames that arrived while no reply was eligible as the answer. */
  ignoredCompleteCount: number;
  lastCompleteAtMs: number | null;
  pendingToolCount: number;
  replyEligible: boolean;
};

type Milestone = {
  [K in keyof PalChatDeadlineProgress]: PalChatDeadlineProgress[K] extends number | null
    ? null extends PalChatDeadlineProgress[K] ? K : never
    : never;
}[keyof PalChatDeadlineProgress];

/** The frame fields the counters read. Content fields are never read here. */
type PalChatProgressFrame = {
  type?: string;
  text_response_part?: { type?: string };
  agent_tool_request?: { tool_name?: string };
  agent_tool_response?: { tool_name?: string };
};

const RECOGNIZED_FRAMES = new Set([
  "ping", "conversation_initiation_metadata", "agent_chat_response_part", "agent_response",
  "agent_tool_request", "agent_tool_response", "agent_response_complete",
]);

const REPLY_AND_TOOL_FRAMES = new Set([
  "agent_chat_response_part", "agent_response", "agent_tool_request", "agent_tool_response",
  "agent_response_complete",
]);

const RECALL_TOOL = "recall_memories";

export type PalChatDeadlineTracker = {
  /** A copy of the record, safe to log. */
  snapshot(): PalChatDeadlineProgress;
  /** Stamps a milestone once; a later call keeps the first time. */
  mark(milestone: Milestone): void;
  registrationStarted(): void;
  registrationReady(): void;
  parseFailure(): void;
  /** Counts a parsed frame by type, before the turn decides what to do with it. */
  frame(frame: PalChatProgressFrame, userMessageSent: boolean): void;
  streamDelta(): void;
  streamPart(frame: PalChatProgressFrame): void;
  reply(): void;
  toolRequest(frame: PalChatProgressFrame): void;
  toolResponse(frame: PalChatProgressFrame): void;
  complete(eligible: boolean): void;
  settle(pendingToolCount: number, replyEligible: boolean): void;
};

export function palChatDeadlineTracker(startedAt: number, now: () => number = Date.now): PalChatDeadlineTracker {
  const progress: PalChatDeadlineProgress = {
    socketOpenAtMs: null,
    metadataAtMs: null,
    memoriesReadyAtMs: null,
    tasteReadyAtMs: null,
    registrationStarted: 0,
    registrationReady: 0,
    registrationReadyAtMs: null,
    sendReturnedAtMs: null,
    firstReplyAtMs: null,
    preSendEventCount: 0,
    parseFailureCount: 0,
    unrecognizedMessageCount: 0,
    replyCount: 0,
    streamDeltaCount: 0,
    lastStreamStopAtMs: null,
    toolRequestCount: 0,
    toolResponseCount: 0,
    recognizedRecallRequestCount: 0,
    recognizedRecallResponseCount: 0,
    lastToolResponseAtMs: null,
    completeCount: 0,
    ignoredCompleteCount: 0,
    lastCompleteAtMs: null,
    pendingToolCount: 0,
    replyEligible: false,
  };
  const elapsed = () => Math.max(0, now() - startedAt);

  return {
    snapshot: () => ({ ...progress }),
    mark(milestone) {
      progress[milestone] ??= elapsed();
    },
    registrationStarted() {
      progress.registrationStarted += 1;
    },
    registrationReady() {
      progress.registrationReady += 1;
      progress.registrationReadyAtMs = elapsed();
    },
    parseFailure() {
      progress.parseFailureCount += 1;
    },
    frame(frame, userMessageSent) {
      const type = frame.type ?? "";
      if (!RECOGNIZED_FRAMES.has(type)) progress.unrecognizedMessageCount += 1;
      if (!userMessageSent && REPLY_AND_TOOL_FRAMES.has(type)) progress.preSendEventCount += 1;
    },
    streamDelta() {
      progress.streamDeltaCount += 1;
    },
    streamPart(frame) {
      if (frame.text_response_part?.type === "stop") progress.lastStreamStopAtMs = elapsed();
    },
    reply() {
      progress.replyCount += 1;
      progress.firstReplyAtMs ??= elapsed();
    },
    toolRequest(frame) {
      progress.toolRequestCount += 1;
      if (frame.agent_tool_request?.tool_name === RECALL_TOOL) progress.recognizedRecallRequestCount += 1;
    },
    toolResponse(frame) {
      progress.toolResponseCount += 1;
      progress.lastToolResponseAtMs = elapsed();
      if (frame.agent_tool_response?.tool_name === RECALL_TOOL) progress.recognizedRecallResponseCount += 1;
    },
    complete(eligible) {
      progress.completeCount += 1;
      progress.lastCompleteAtMs = elapsed();
      if (!eligible) progress.ignoredCompleteCount += 1;
    },
    settle(pendingToolCount, replyEligible) {
      progress.pendingToolCount = pendingToolCount;
      progress.replyEligible = replyEligible;
    },
  };
}
