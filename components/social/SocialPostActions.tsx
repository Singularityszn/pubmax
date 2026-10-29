"use client";

import { Bookmark, Flag, MessageCircle, Beer } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";

import { authedActionFetch, authedFetch } from "@/lib/authedFetch";
import { discardBody } from "@/lib/responseBody";
import { relativeTime } from "@/lib/relativeTime";

type Summary = {
  cheered: boolean;
  saved: boolean;
  cheerCount: number;
};

type Comment = {
  id: string;
  body: string;
  author: { handle: string };
  moderationState: "pending" | "approved" | "needs_review";
  createdAt: string;
};

const REPORT_REASONS = [
  ["harassment", "Harassment"],
  ["hate", "Hate"],
  ["threat", "A threat"],
  ["doxxing", "Shares private details"],
  ["spam", "Spam"],
  ["other", "Something else"],
] as const;

function requestKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `key-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * The row under a post: Cheers, comments, save and report, the way a photo
 * app lays them out. Counts are what this post has, read for the viewer; no
 * count ever changes where a post sits in a feed (the feed stays in time
 * order).
 */
export default function SocialPostActions({
  postId,
}: {
  postId: string;
}) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryError, setSummaryError] = useState(false);
  const [summaryAttempt, setSummaryAttempt] = useState(0);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [reactionPending, setReactionPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const commentsId = useId();
  const inputId = useId();
  const commentKey = useRef(requestKey());
  const reactionInFlight = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    void authedFetch(`/api/social/interactions?view=summary&postId=${encodeURIComponent(postId)}`, {
      credentials: "same-origin",
      signal: controller.signal,
    }, { requiresIdentity: true })
      .then((response) => {
        if (!response.ok) {
          discardBody(response);
          throw new Error("Reactions unavailable");
        }
        return response.json();
      })
      .then((body: { summary?: Summary } | null) => {
        const value = body?.summary;
        if (!value || typeof value.cheered !== "boolean" || typeof value.saved !== "boolean" ||
          !Number.isSafeInteger(value.cheerCount) || value.cheerCount < 0) {
          throw new Error("Reactions unavailable");
        }
        if (!controller.signal.aborted) setSummary(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setSummaryError(true);
      });
    return () => controller.abort();
  }, [postId, summaryAttempt]);

  const loadComments = useCallback(async () => {
    setCommentsLoading(true);
    setCommentsError(false);
    try {
      const response = await authedFetch(`/api/social/interactions?view=comments&postId=${encodeURIComponent(postId)}`, {
        credentials: "same-origin",
      }, { requiresIdentity: true });
      if (!response.ok) {
        discardBody(response);
        throw new Error("Comments unavailable");
      }
      const body = (await response.json()) as { items?: Comment[] };
      if (!Array.isArray(body.items)) throw new Error("Comments unavailable");
      setComments(body.items);
    } catch {
      setCommentsError(true);
    } finally {
      setCommentsLoading(false);
    }
  }, [postId]);


  async function toggle(kind: "cheer" | "save") {
    if (!summary || reactionInFlight.current) return;
    reactionInFlight.current = true;
    setReactionPending(true);
    setNotice(null);
    const on = kind === "cheer" ? !summary.cheered : !summary.saved;
    const previous = summary;
    setSummary(kind === "cheer"
      ? { ...summary, cheered: on, cheerCount: Math.max(0, summary.cheerCount + (on ? 1 : -1)) }
      : { ...summary, saved: on });
    try {
      const response = await authedActionFetch("/api/social/interactions", {
        method: on ? "PUT" : "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "desired", postId, kind }),
      }, { requiresIdentity: true });
      discardBody(response);
      if (!response.ok) throw new Error("refused");
    } catch {
      setSummary(previous);
      setNotice(kind === "cheer" ? "Cheers did not go through. Try again." : "Save did not go through. Try again.");
    } finally {
      reactionInFlight.current = false;
      setReactionPending(false);
    }
  }

  async function sendComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setNotice(null);
    try {
      const response = await authedActionFetch("/api/social/interactions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "Idempotency-Key": commentKey.current },
        body: JSON.stringify({ action: "comment", postId, body }),
      }, { requiresIdentity: true });
      if (!response.ok) {
        discardBody(response);
        throw new Error("refused");
      }
      const result = (await response.json()) as { comment?: Comment };
      commentKey.current = requestKey();
      setDraft("");
      if (result.comment) setComments((current) => [...(current ?? []), result.comment!]);
      setNotice(result.comment?.moderationState === "approved" ? null : "Sent. It shows to others once it clears review.");
    } catch {
      setNotice("That comment did not send. Your words are still here.");
    } finally {
      setSending(false);
    }
  }

  async function report(reason: (typeof REPORT_REASONS)[number][0]) {
    setReportOpen(false);
    try {
      const response = await authedActionFetch("/api/social/interactions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "report", kind: "post", id: postId, reason }),
      }, { requiresIdentity: true });
      discardBody(response);
      setNotice(response.ok ? "Reported. The team reads every report." : "That report did not send. Try again.");
    } catch {
      setNotice("That report did not send. Try again.");
    }
  }

  const cheerCount = summary?.cheerCount ?? 0;
  return (
    <div className="socialPostActions">
      <div className="socialPostActions__row">
        <button
          type="button"
          className="socialPostAction"
          aria-pressed={summary?.cheered ?? false}
          disabled={!summary || reactionPending}
          onClick={() => void toggle("cheer")}
        >
          <Beer size={20} aria-hidden="true" />
          <span>{cheerCount > 0 ? `Cheers ${cheerCount}` : "Cheers"}</span>
        </button>
        <button
          type="button"
          className="socialPostAction"
          aria-expanded={commentsOpen}
          aria-controls={commentsId}
          onClick={() => {
            if (!commentsOpen && comments === null && !commentsLoading) void loadComments();
            setCommentsOpen((open) => !open);
          }}
        >
          <MessageCircle size={20} aria-hidden="true" />
          <span>{comments && comments.length > 0 ? `Comments ${comments.length}` : "Comment"}</span>
        </button>
        <button
          type="button"
          className="socialPostAction socialPostAction--end"
          aria-pressed={summary?.saved ?? false}
          aria-label={summary?.saved ? "Saved" : "Save"}
          disabled={!summary || reactionPending}
          onClick={() => void toggle("save")}
        >
          <Bookmark size={20} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="socialPostAction"
          aria-label="Report this post"
          aria-expanded={reportOpen}
          onClick={() => setReportOpen((open) => !open)}
        >
          <Flag size={20} aria-hidden="true" />
        </button>
      </div>
      {summaryError ? (
        <div role="alert">
          <p>Reactions could not load.</p>
          <button type="button" onClick={() => {
            setSummaryError(false);
            setSummaryAttempt((attempt) => attempt + 1);
          }}>Retry reactions</button>
        </div>
      ) : null}
      {reportOpen ? (
        <div className="socialPostReport" role="group" aria-label="Why are you reporting this post?">
          {REPORT_REASONS.map(([reason, label]) => (
            <button key={reason} type="button" onClick={() => void report(reason)}>{label}</button>
          ))}
        </div>
      ) : null}
      {notice ? <p className="socialPostActions__notice" role="status">{notice}</p> : null}
      {commentsOpen ? (
        <section id={commentsId} className="socialPostComments" aria-label="Comments">
          {commentsLoading ? <p role="status">Loading comments…</p> : null}
          {commentsError ? (
            <div role="alert">
              <p>Comments could not load.</p>
              <button type="button" onClick={() => void loadComments()}>Retry comments</button>
            </div>
          ) : null}
          {!commentsLoading && !commentsError && comments && comments.length === 0 ? <p className="socialPostComments__empty">No comments yet.</p> : null}
          {comments && comments.length > 0 ? (
            <ul>
              {comments.map((comment) => {
                const when = relativeTime(comment.createdAt);
                return (
                  <li key={comment.id}>
                    <strong>@{comment.author.handle}</strong> {comment.body}
                    {when ? <time dateTime={comment.createdAt}>{when}</time> : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
          <form className="socialPostComments__form" onSubmit={(event) => void sendComment(event)}>
            <label htmlFor={inputId} className="socialPostComments__label">Add a comment</label>
            <input
              id={inputId}
              value={draft}
              maxLength={1000}
              placeholder="Add a comment"
              onChange={(event) => setDraft(event.currentTarget.value)}
            />
            <button type="submit" disabled={sending || draft.trim().length === 0}>Send</button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
