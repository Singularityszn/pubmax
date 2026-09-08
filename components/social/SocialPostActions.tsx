"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/authContext";
import { useViewerSession } from "@/components/auth/useViewerSession";
import { Button } from "@/components/ui/button";
import { authedActionJson } from "@/lib/authedFetch";
import type { SocialCommentDTO, SocialInteractionSummary, SocialReportReason } from "@/lib/socialInteractions";
import type { SocialPostCommentPolicy, SocialPostDTO } from "@/lib/socialPosts";
import "./SocialPostActions.css";

const ENDPOINT = "/api/social/interactions";
type CommentPage = { items: SocialCommentDTO[]; nextCursor: string | null };

class InteractionRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request(path: string, signal: AbortSignal, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const { response, body } = await authedActionJson<Record<string, unknown>>(path, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  }, { requiresIdentity: true });
  if (!response.ok) throw new InteractionRequestError(typeof body?.error === "string" ? body.error : "This action is unavailable. Try again.", response.status);
  if (!body || typeof body !== "object") throw new Error("The reply could not be read. Try again.");
  return body;
}

async function readPost(postId: string, signal: AbortSignal): Promise<SocialPostCommentPolicy> {
  const { post } = await request(`/api/social/posts/${encodeURIComponent(postId)}`, signal);
  const current = post as SocialPostDTO | undefined;
  if (current?.id !== postId || current.moderationState !== "approved") {
    throw new Error("This post is not available for interactions.");
  }
  if (!["open", "friends", "locked"].includes(current.commentPolicy)) throw new Error("Comment settings could not be read.");
  return current.commentPolicy;
}

function isComment(value: unknown, postId: string): value is SocialCommentDTO {
  const row = value as SocialCommentDTO | null;
  return !!row && typeof row.id === "string" && row.postId === postId && typeof row.body === "string"
    && typeof row.author?.handle === "string" && typeof row.createdAt === "string"
    && ["pending", "approved", "needs_review"].includes(row.moderationState);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "This action is unavailable. Try again.";
}

const REPORT_REASONS: Record<SocialReportReason, string> = {
  harassment: "Harassment", hate: "Hate", threat: "Threat", doxxing: "Private information", spam: "Spam", other: "Other",
};

function ReportPost({ postId }: { postId: string }) {
  const reasonId = useId();
  const lifetime = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [received, setReceived] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);

  async function report(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || lock.current || received || !Object.hasOwn(REPORT_REASONS, reason)) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await request(ENDPOINT, signal, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "report", kind: "post", id: postId, reason }),
      });
      const receipt = result.report as { id?: unknown; createdAt?: unknown } | undefined;
      if (!receipt || typeof receipt.id !== "string" || !receipt.id || typeof receipt.createdAt !== "string") {
        throw new Error("The report could not be confirmed. Retry to check it.");
      }
      if (!signal.aborted) setReceived(true);
    } catch (error) {
      if (!signal.aborted) setError(errorMessage(error));
    } finally {
      lock.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }

  return <details className="socialPostActions__report">
    <summary>Report</summary>
    <form onSubmit={(event) => void report(event)}>
      <label htmlFor={reasonId}>Report reason</label>
      <select id={reasonId} required value={reason} disabled={busy} onChange={(event) => {
        setReason(event.target.value);
        setError("");
        setReceived(false);
      }}>
        <option value="">Choose a reason</option>
        {Object.entries(REPORT_REASONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <Button type="submit" variant="secondary" disabled={busy || received || !reason}>
        {busy ? "Sending report…" : error ? "Retry report" : "Report post"}
      </Button>
      {error && <p role="alert">{error}</p>}
      <p role="status">{received ? "Report received." : ""}</p>
    </form>
  </details>;
}

function PostActions({ post }: { post: SocialPostDTO }) {
  const panelId = useId();
  const fieldId = useId();
  const container = useRef<HTMLDivElement | null>(null);
  const lifetime = useRef<AbortController | null>(null);
  const summaryRequested = useRef(false);
  const summaryReadLock = useRef<AbortSignal | null>(null);
  const cheerLock = useRef(false);
  const commentReadLock = useRef(false);
  const sendLock = useRef(false);
  const commentAttempt = useRef<{ body: string; key: string } | null>(null);
  const [summary, setSummary] = useState<SocialInteractionSummary | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [cheerBusy, setCheerBusy] = useState(false);
  const [policy, setPolicy] = useState(post.commentPolicy);
  const [expanded, setExpanded] = useState(false);
  const [comments, setComments] = useState<CommentPage | null>(null);
  const [commentsBusy, setCommentsBusy] = useState(false);
  const [commentsError, setCommentsError] = useState("");
  const [failedCursor, setFailedCursor] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [receipt, setReceipt] = useState("");

  const refreshSummary = useCallback(async (signal: AbortSignal) => {
    if (summaryReadLock.current && !summaryReadLock.current.aborted) return;
    summaryReadLock.current = signal;
    try {
      const body = await request(`${ENDPOINT}?view=summary&postId=${encodeURIComponent(post.id)}`, signal);
      const next = body.summary as SocialInteractionSummary | undefined;
      if (!next || typeof next.cheered !== "boolean" || !Number.isSafeInteger(next.cheerCount) || next.cheerCount < 0) {
        throw new Error("Cheers could not be read. Try again.");
      }
      if (signal.aborted) return;
      setSummary(next);
    } catch (error) {
      if (!signal.aborted) setSummaryError(errorMessage(error));
    } finally {
      if (summaryReadLock.current === signal) summaryReadLock.current = null;
      if (!signal.aborted) setSummaryBusy(false);
    }
  }, [post.id]);

  function reloadSummary(signal: AbortSignal) {
    summaryRequested.current = true;
    setSummaryBusy(true);
    setSummaryError("");
    setSummary(null);
    return refreshSummary(signal);
  }

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
      if (controller.signal.aborted || !entries.some((entry) => entry.isIntersecting)) return;
      observer?.disconnect();
      if (summaryRequested.current) return;
      summaryRequested.current = true;
      setSummaryBusy(true);
      void refreshSummary(controller.signal);
    });
    if (container.current) observer?.observe(container.current);
    return () => {
      controller.abort();
      observer?.disconnect();
      summaryRequested.current = false;
    };
  }, [refreshSummary]);

  async function cheer() {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || summaryBusy || cheerLock.current) return;
    if (!summary) { await reloadSummary(signal); return; }
    cheerLock.current = true;
    setCheerBusy(true);
    setSummaryError("");
    try {
      const result = await request(ENDPOINT, signal, {
        method: summary.cheered ? "DELETE" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "desired", postId: post.id, kind: "cheer" }),
      });
      if (result.ok !== true) throw new Error("The Cheer change could not be confirmed. Refresh and try again.");
      if (!signal.aborted) await reloadSummary(signal);
    } catch (error) {
      if (!signal.aborted) {
        setSummary(null);
        setSummaryError(`${errorMessage(error)} Refresh Cheers before another change.`);
      }
    } finally {
      cheerLock.current = false;
      if (!signal.aborted) setCheerBusy(false);
    }
  }

  async function loadComments(cursor: string | null) {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || commentReadLock.current) return;
    commentReadLock.current = true;
    setCommentsBusy(true);
    setCommentsError("");
    setFailedCursor(cursor);
    let sourceReadable = false;
    try {
      const nextPolicy = await readPost(post.id, signal);
      sourceReadable = true;
      if (!signal.aborted) setPolicy(nextPolicy);
      const query = new URLSearchParams({ view: "comments", postId: post.id, limit: "20" });
      if (cursor) query.set("cursor", cursor);
      const body = await request(`${ENDPOINT}?${query}`, signal);
      if (!Array.isArray(body.items) || !body.items.every((item) => isComment(item, post.id) && item.moderationState === "approved")
        || !(body.nextCursor === null || typeof body.nextCursor === "string")) {
        throw new Error("Comments could not be read. Try again.");
      }
      if (signal.aborted) return;
      const page = body as CommentPage;
      setComments((previous) => ({
        items: [...new Map([...(cursor ? previous?.items ?? [] : []), ...page.items].map((item) => [item.id, item])).values()],
        nextCursor: page.nextCursor,
      }));
    } catch (error) {
      if (!signal.aborted) {
        setCommentsError(errorMessage(error));
        const accessRefused = !sourceReadable || (error instanceof InteractionRequestError && [401, 403, 404].includes(error.status));
        if (!cursor || accessRefused) {
          setComments(null);
          setFailedCursor(null);
        }
        if (accessRefused) {
          setSummary(null);
          setSummaryError(errorMessage(error));
        }
      }
    } finally {
      commentReadLock.current = false;
      if (!signal.aborted) setCommentsBusy(false);
    }
  }

  async function sendComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const signal = lifetime.current?.signal;
    const body = draft.trim();
    if (!signal || signal.aborted || sendLock.current || !body || policy === "locked" || !comments) return;
    sendLock.current = true;
    setSending(true);
    setSendError("");
    setReceipt("");
    try {
      if (commentAttempt.current?.body !== body) commentAttempt.current = { body, key: crypto.randomUUID() };
      const result = await request(ENDPOINT, signal, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": commentAttempt.current.key },
        body: JSON.stringify({ action: "comment", postId: post.id, body }),
      });
      if (!isComment(result.comment, post.id)) throw new Error("The comment could not be confirmed. Retry to check it.");
      if (signal.aborted) return;
      setDraft("");
      commentAttempt.current = null;
      setReceipt(result.comment.moderationState === "approved" ? "Comment posted. Refresh comments to read it."
        : "Comment received. It will appear after review.");
    } catch (error) {
      if (!signal.aborted) setSendError(errorMessage(error));
    } finally {
      sendLock.current = false;
      if (!signal.aborted) setSending(false);
    }
  }

  return (
    <div className="socialPostActions" ref={container}>
      <div className="socialPostActions__bar">
        <Button type="button" variant="ghost" aria-pressed={summary?.cheered} disabled={summaryBusy || cheerBusy || !!summaryError} onClick={() => void cheer()}>
          {cheerBusy ? "Saving Cheer…" : "Cheer"}{summary && <span className="socialPostActions__count">{summary.cheerCount}</span>}
        </Button>
        <Button type="button" variant="ghost" aria-expanded={expanded} aria-controls={panelId} onClick={() => {
          setExpanded(!expanded);
          if (!expanded) void loadComments(null);
        }}>Comments</Button>
        <ReportPost postId={post.id} />
      </div>
      {summaryBusy && <p role="status">Loading Cheers…</p>}
      {summaryError && <div className="socialPostActions__feedback"><p role="alert">{summaryError}</p>
        <Button type="button" variant="ghost" disabled={summaryBusy || cheerBusy} onClick={() => {
          if (lifetime.current) void reloadSummary(lifetime.current.signal);
        }}>Refresh Cheers</Button>
      </div>}
      <section id={panelId} hidden={!expanded} aria-label="Post comments" className="socialPostActions__comments">
        {commentsBusy && <p role="status">Loading comments…</p>}
        {commentsError && <div className="socialPostActions__feedback"><p role="alert">{commentsError}</p>
          <Button type="button" variant="ghost" disabled={commentsBusy} onClick={() => void loadComments(failedCursor)}>Retry comments</Button>
        </div>}
        {comments && <>
          {comments.items.length === 0 && !commentsBusy && <p>No comments to show yet.</p>}
          <ul className="socialPostActions__list">{comments.items.map((comment) => <li key={comment.id}>
            <a href={`/u/${encodeURIComponent(comment.author.handle)}`}>@{comment.author.handle}</a>
            <p>{comment.body}</p>
          </li>)}</ul>
          <div className="socialPostActions__bar">
            {comments.nextCursor && <Button type="button" variant="ghost" disabled={commentsBusy} onClick={() => void loadComments(comments.nextCursor)}>More comments</Button>}
            <Button type="button" variant="ghost" disabled={commentsBusy} onClick={() => void loadComments(null)}>Refresh comments</Button>
          </div>
          {policy === "locked" ? <p>Comments are closed.</p> : <form onSubmit={(event) => void sendComment(event)}>
            <label htmlFor={fieldId}>Add a comment</label>
            {policy === "friends" && !post.ownedByViewer && <p>Only mutuals can comment.</p>}
            <textarea id={fieldId} value={draft} maxLength={1000} rows={3} required readOnly={sending}
              onChange={(event) => { setDraft(event.target.value); setReceipt(""); }} />
            <Button type="submit" variant="secondary" disabled={sending || commentsBusy || !draft.trim()}>
              {sending ? "Sending comment…" : sendError ? "Retry comment" : "Send comment"}
            </Button>
          </form>}
        </>}
        {sendError && <p role="alert">{sendError}</p>}
        <p role="status" aria-live="polite">{receipt}</p>
      </section>
    </div>
  );
}

export function SocialPostActions({ post }: { post: SocialPostDTO }) {
  const { accountRevision, user, identityResolved, handle } = useAuth();
  const viewer = useViewerSession();
  if (viewer.signedOut) return <div className="socialPostActions"><Button asChild variant="ghost"><a href="/login?mode=signin&from=%2Fsocial">Sign in to interact</a></Button></div>;
  if (!viewer.signedIn || !identityResolved || !handle || post.moderationState !== "approved") return null;
  return <PostActions key={`${post.id}:${post.mutationVersion}:${post.commentPolicy}:${accountRevision}:${user?.id}`} post={post} />;
}

export default SocialPostActions;
