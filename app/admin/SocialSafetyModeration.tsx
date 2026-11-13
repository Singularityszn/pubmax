"use client";

// The safety queues (launch plan P0 item 6, migration 0224): open Social
// reports, including "Report this person", and flagged DMs. A moderator can
// close a report, mark a DM reviewed, or suspend the person, which writes an
// audit row with the reason in the same transaction. This lane fetches and
// decides for itself through /api/admin/social-safety, on the same admin
// session as the console.

import { useCallback, useEffect, useState } from "react";

import { displayHandle } from "@/lib/handleDisplay";
import { discardBody } from "@/lib/responseBody";
import { SOCIAL_REPORT_REASON_LABELS } from "@/lib/socialInteractions";
import {
  parseSafetyQueues,
  parseMessageEvidence,
  parseReportedContentEvidence,
  type MessageEvidence,
  type ReportedContentEvidence,
  SUSPEND_REASON_MAX,
  SUSPEND_REASON_MIN,
  type AccountState,
  type FlaggedMessageItem,
  type SafetyQueues,
  type SafetyReportItem,
} from "@/lib/socialSafetyModeration";

type LoadState = "loading" | "ready" | "unavailable";

const SESSION_FETCH: RequestInit = { credentials: "include" };
const ENDPOINT = "/api/admin/social-safety";

const KIND_LABEL: Record<SafetyReportItem["kind"], string> = {
  post: "Post",
  comment: "Comment",
  quote: "Quote",
  profile: "Person",
};

type SuspendTarget = {
  key: string;
  profileId: string;
  handle: string;
  state: AccountState | null;
  reportId: string | null;
  suggestedReason: string;
};

/** "Sat 7 Nov, 17:40" in London time. */
function when(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/London",
  }).format(new Date(iso));
}

function SuspendControl({
  target,
  busy,
  onSubmit,
}: {
  target: SuspendTarget;
  busy: boolean;
  onSubmit: (target: SuspendTarget, reason: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(target.suggestedReason);
  const suspending = target.state !== "suspended";
  const verb = suspending ? "Suspend" : "Reinstate";
  const trimmed = reason.trim();
  const valid = trimmed.length >= SUSPEND_REASON_MIN && trimmed.length <= SUSPEND_REASON_MAX;
  if (!open) {
    return (
      <button
        type="button"
        className={`admin-btn ${suspending ? "admin-keep" : "admin-restore"}`}
        disabled={busy}
        onClick={() => setOpen(true)}
      >
        {`${verb} ${displayHandle(target.handle)}`}
      </button>
    );
  }
  return (
    <form
      className="admin-suspend"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onSubmit(target, trimmed);
      }}
    >
      <label className="admin-field">
        {`Why ${suspending ? "suspend" : "reinstate"} ${displayHandle(target.handle)}? The audit log keeps this.`}
        <textarea
          value={reason}
          maxLength={SUSPEND_REASON_MAX}
          rows={2}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <div className="admin-actions">
        <button
          type="submit"
          className={`admin-btn ${suspending ? "admin-keep" : "admin-restore"}`}
          disabled={busy || !valid}
        >
          {busy ? "Saving…" : `Yes, ${verb.toLowerCase()}`}
        </button>
        <button type="button" className="admin-btn" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function AccountBadge({ state }: { state: AccountState | null }) {
  if (state === "suspended") return <span className="admin-report">Suspended</span>;
  if (state === null) return <span>No Social account</span>;
  return null;
}

function MessageAttachmentEvidence({ messageId, busy, view }: {
  messageId: string;
  busy: boolean;
  view: () => Promise<Record<string, unknown> | null>;
}) {
  const [evidence, setEvidence] = useState<MessageEvidence | null>(null);
  return (
    <div>
      <button type="button" className="admin-btn" disabled={busy} onClick={async () => {
        setEvidence(null);
        const body = await view();
        setEvidence(parseMessageEvidence(body?.evidence));
      }}>View reported attachment</button>
      {evidence?.kind === "photo" ? (
        <a href={evidence.url} target="_blank" rel="noreferrer">Open reported photo (expires after 3 minutes)</a>
      ) : null}
      {evidence?.kind === "poll" ? (
        <div aria-label={`Reported poll ${messageId}`}>
          <p>{evidence.question}</p>
          <ul>{evidence.options.map((option, index) => <li key={index}>{option}</li>)}</ul>
        </div>
      ) : null}
      {evidence?.kind === "venue" ? <p>Shared pub: {evidence.venueId}</p> : null}
      {evidence?.kind === "contact" ? <p>Shared person: {displayHandle(evidence.handle)}</p> : null}
      {evidence?.kind === "event" ? <p>Shared Plan: {evidence.planId}</p> : null}
    </div>
  );
}

function ReportEvidence({ report, busy, view }: {
  report: SafetyReportItem;
  busy: boolean;
  view: () => Promise<Record<string, unknown> | null>;
}) {
  const [evidence, setEvidence] = useState<ReportedContentEvidence | null>(null);
  return (
    <div>
      <button type="button" className="admin-btn" disabled={busy} onClick={async () => {
        setEvidence(null);
        const body = await view();
        const parsed = parseReportedContentEvidence(body?.evidence);
        setEvidence(parsed?.reportId === report.reportId && parsed.kind === report.kind
          && parsed.contentId === report.contentId ? parsed : null);
      }}>View reported {report.kind}</button>
      {evidence ? (
        <div className="admin-post-evidence" aria-label={`Reported ${report.kind} evidence`}>
          <p className="admin-excerpt">{evidence.body}</p>
          {evidence.media.map((media) => media.kind === "photo" ? (
            <picture key={media.url}>
              <img src={media.url} alt="Reported post photo" referrerPolicy="no-referrer" />
            </picture>
          ) : (
            <video key={media.url} src={media.url} controls preload="metadata" aria-label="Reported post video" />
          ))}
          {evidence.media.length > 0 ? <p>Media links expire after 3 minutes. View the post again to renew them.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export default function SocialSafetyModeration() {
  const [queues, setQueues] = useState<SafetyQueues>({ reports: [], flaggedMessages: [] });
  const [state, setState] = useState<LoadState>("loading");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(ENDPOINT, SESSION_FETCH);
      if (!response.ok) {
        discardBody(response);
        setState("unavailable");
        return;
      }
      const parsed = parseSafetyQueues(await response.json());
      if (!parsed) {
        setState("unavailable");
        return;
      }
      setQueues(parsed);
      setState("ready");
    } catch {
      setState("unavailable");
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function post(key: string, payload: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    setPending(key);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(ENDPOINT, {
        ...SESSION_FETCH,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (!response.ok) {
        setError(typeof body?.error === "string" ? body.error : "That decision did not save. Try again.");
        return null;
      }
      if (payload.action !== "view_message_evidence" && payload.action !== "view_report_evidence") await load();
      return body ?? {};
    } catch {
      setError("That decision did not save. Try again.");
      return null;
    } finally {
      setPending(null);
    }
  }

  async function setSuspension(target: SuspendTarget, reason: string) {
    const action = target.state !== "suspended" ? "suspend" : "reinstate";
    const body = await post(target.key, {
      action,
      profileId: target.profileId,
      reason,
      reportId: target.reportId,
    });
    if (!body) return;
    const next: AccountState = action === "suspend" ? "suspended" : "active";
    setNotice(
      body.code === "unchanged"
        ? `${displayHandle(target.handle)} was already ${next}.`
        : `${displayHandle(target.handle)} is ${next}. The audit log has the reason.`,
    );
  }

  function reportTarget(report: SafetyReportItem): SuspendTarget | null {
    if (!report.targetProfileId || !report.targetHandle) return null;
    return {
      key: `report:${report.reportId}`,
      profileId: report.targetProfileId,
      handle: report.targetHandle,
      state: report.targetAccountState,
      reportId: report.reportId,
      suggestedReason: `Report: ${SOCIAL_REPORT_REASON_LABELS[report.reason].toLowerCase()}`,
    };
  }

  function messageTarget(message: FlaggedMessageItem): SuspendTarget | null {
    if (!message.senderProfileId) return null;
    return {
      key: `message:${message.messageId}`,
      profileId: message.senderProfileId,
      handle: message.senderHandle,
      state: message.senderAccountState,
      reportId: null,
      suggestedReason: "Flagged DM",
    };
  }

  const busy = pending !== null;

  return (
    <>
      <h2 className="admin-section">Reports from people</h2>
      {state === "loading" ? <div className="admin-empty" role="status">Loading reports…</div> : null}
      {state === "unavailable" ? (
        <div className="admin-empty" role="alert">
          <span>Reports and flagged DMs could not be loaded.</span>
          <button type="button" className="admin-retry" onClick={() => { setState("loading"); void load(); }}>Try again</button>
        </div>
      ) : null}
      {error ? <p className="admin-msg" role="alert">{error}</p> : null}
      {notice ? <p className="admin-msg" role="status">{notice}</p> : null}
      {state === "ready" && queues.reports.length === 0 ? (
        <div className="admin-empty"><strong>No open reports</strong></div>
      ) : null}
      {state === "ready" && queues.reports.length > 0 ? (
        <div className="admin-list">
          {queues.reports.map((report) => {
            const target = reportTarget(report);
            return (
              <article className="admin-card" key={report.reportId}>
                <div className="admin-card-head">
                  <span className="admin-handle">
                    {report.targetHandle ? displayHandle(report.targetHandle) : "Content has gone"}
                  </span>
                  <span className="admin-report">{SOCIAL_REPORT_REASON_LABELS[report.reason]}</span>
                </div>
                {report.excerpt ? <p className="admin-excerpt">{report.excerpt}</p> : null}
                {report.kind !== "profile" ? <ReportEvidence
                  report={report}
                  busy={busy}
                  view={() => post(`evidence:${report.reportId}`, { action: "view_report_evidence", reportId: report.reportId })}
                /> : null}
                <div className="admin-meta">
                  <span>{KIND_LABEL[report.kind]}</span>
                  <span>Reported by {displayHandle(report.reporterHandle)}</span>
                  <span><time dateTime={report.createdAt}>{when(report.createdAt)}</time></span>
                  <AccountBadge state={report.targetAccountState} />
                </div>
                <div className="admin-actions">
                  <button
                    type="button"
                    className="admin-btn"
                    disabled={busy}
                    onClick={() => void post(report.reportId, { action: "resolve_report", reportId: report.reportId })}
                  >
                    {pending === report.reportId ? "Saving…" : "Close report"}
                  </button>
                  {target ? (
                    <SuspendControl
                      key={`${target.key}:${target.state}`}
                      target={target}
                      busy={busy}
                      onSubmit={(value, reason) => void setSuspension(value, reason)}
                    />
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      <h2 className="admin-section">Flagged DMs</h2>
      {state === "ready" && queues.flaggedMessages.length === 0 ? (
        <div className="admin-empty"><strong>No flagged DMs to review</strong></div>
      ) : null}
      {state === "ready" && queues.flaggedMessages.length > 0 ? (
        <div className="admin-list">
          {queues.flaggedMessages.map((message) => {
            const target = messageTarget(message);
            return (
              <article className="admin-card" key={message.messageId}>
                <div className="admin-card-head">
                  <span className="admin-handle">From {displayHandle(message.senderHandle)}</span>
                  <span className="admin-report">Flagged</span>
                </div>
                <p className="admin-excerpt">{message.body || "A photo or poll with no text"}</p>
                {message.hasAttachment ? <MessageAttachmentEvidence
                  messageId={message.messageId}
                  busy={busy}
                  view={() => post(`evidence:${message.messageId}`, { action: "view_message_evidence", messageId: message.messageId })}
                /> : null}
                <div className="admin-meta">
                  {message.flaggedBy ? <span>Flagged by {displayHandle(message.flaggedBy)}</span> : null}
                  <span>Sent <time dateTime={message.sentAt}>{when(message.sentAt)}</time></span>
                  <AccountBadge state={message.senderAccountState} />
                </div>
                <div className="admin-actions">
                  <button
                    type="button"
                    className="admin-btn"
                    disabled={busy}
                    onClick={() => void post(message.messageId, { action: "review_message", messageId: message.messageId })}
                  >
                    {pending === message.messageId ? "Saving…" : "Mark reviewed"}
                  </button>
                  {target ? (
                    <SuspendControl
                      key={`${target.key}:${target.state}`}
                      target={target}
                      busy={busy}
                      onSubmit={(value, reason) => void setSuspension(value, reason)}
                    />
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
