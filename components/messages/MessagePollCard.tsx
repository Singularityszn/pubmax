"use client";

// A poll inside a bubble: the question, one button per option, and what the
// thread has answered.
//
// WHAT IT SHOWS AND WHAT IT NEVER SHOWS. Counts and the share of the vote, plus
// a mark on the option THIS reader chose. No voter is named — not to the
// author, not to the person who opened the thread — because in a room of five
// people "who picked the Wetherspoon" changes what people are willing to
// answer, and the honest way to have that conversation is out loud in the
// thread (`lib/messagePoll.ts` rule 2).
//
// A tap is optimistic in the same way a send is: the bar moves now and the
// server's own answer replaces it, because a poll that waits a round trip to
// acknowledge a tap reads as a poll that did not hear you.

import { useCallback, useState } from "react";

import {
  pollOptionLabel,
  pollOptionShare,
  pollTotalLine,
  POLL_VOTE_FAILED_LINE,
  type MessagePollView,
} from "@/lib/messagePoll";

export default function MessagePollCard({
  poll,
  disabled,
  onVote,
}: {
  poll: MessagePollView;
  /** True for a message this reader cannot answer (an outbox bubble, a flagged row). */
  disabled?: boolean;
  onVote?: (optionIndex: number) => Promise<MessagePollView | null>;
}): React.JSX.Element {
  const [view, setView] = useState<MessagePollView>(poll);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const vote = useCallback(
    async (optionIndex: number) => {
      if (!onVote || busy || disabled) return;
      setBusy(true);
      setFailed(false);
      try {
        const answered = await onVote(optionIndex);
        if (answered) setView(answered);
        else setFailed(true);
      } catch {
        setFailed(true);
      } finally {
        setBusy(false);
      }
    },
    [busy, disabled, onVote],
  );

  // The card's own state wins once somebody has answered on this device; a
  // refetch that carried a newer tally arrives as a new `poll` prop on a
  // remounted bubble, which is when the thread's own read is the fresher one.
  const shown = view.question === poll.question && view.totalVotes >= poll.totalVotes ? view : poll;

  return (
    <div className="messagePoll">
      <p className="messagePollQuestion">{shown.question}</p>
      <ul className="messagePollOptions">
        {shown.options.map((option) => {
          const chosen = shown.viewerOptionIndex === option.index;
          const share = pollOptionShare(option.votes, shown.totalVotes);
          return (
            <li key={option.index}>
              <button
                type="button"
                className="messagePollOption"
                aria-pressed={chosen}
                aria-label={pollOptionLabel(option, shown.totalVotes)}
                disabled={disabled || busy || !onVote}
                onClick={() => void vote(option.index)}
              >
                <span
                  className="messagePollBar"
                  style={{ "--message-poll-share": `${share}%` } as React.CSSProperties}
                  aria-hidden="true"
                />
                <span className="messagePollOptionLabel">{option.label}</span>
                {shown.totalVotes > 0 ? (
                  <span className="messagePollOptionCount">{option.votes}</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="messagePollTotal">{pollTotalLine(shown.totalVotes)}</p>
      {failed ? (
        <p className="messagePollError" role="alert">
          {POLL_VOTE_FAILED_LINE}
        </p>
      ) : null}
    </div>
  );
}
