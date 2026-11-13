"use client";

import { useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { authedActionFetch } from "@/lib/authedFetch";
import { displayHandle } from "@/lib/handleDisplay";
import { normalizeHandle } from "@/lib/profiles";
import {
  SOCIAL_REPORT_REASON_LABELS,
  SOCIAL_REPORT_REASONS,
  type SocialReportReason,
} from "@/lib/socialInteractions";

import "@/components/social/reportPerson.css";

// "Report this person" (launch plan P0 item 6): on a profile and on the crew
// page. A report goes to the moderators' queue (/admin) and nowhere else: the
// person is not told, and it changes nothing until a moderator acts. It is not
// a block; the folded Mute or block control beside it is the viewer's own
// choice. A signed-out viewer, or a viewer looking at themselves, sees nothing.

const FAILED = "That report did not send. Try again.";
const SENT = "Reported. A moderator reads every report.";

export default function ReportPerson({
  handles,
  viewerHandle,
}: {
  /** The people this control can report. One handle reports them directly. */
  handles: readonly string[];
  viewerHandle?: string | null;
}): React.JSX.Element | null {
  const { user, handle: authHandle } = useAuth();
  const viewer = normalizeHandle(authHandle ?? "") || normalizeHandle(viewerHandle ?? "");
  const targets = [...new Set(handles.map((handle) => normalizeHandle(handle)).filter(Boolean))]
    .filter((handle) => handle !== viewer);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  if (!user || targets.length === 0) return null;
  const only = targets.length === 1 ? targets[0] : null;
  const target = only ?? (picked && targets.includes(picked) ? picked : null);

  async function report(handle: string, reason: SocialReportReason) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await authedActionFetch("/api/social/interactions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "report", kind: "profile", targetHandle: handle, reason }),
      }, { requiresIdentity: true });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        setError(offlineOrMessage(errorMessageFrom(body, FAILED)));
        return;
      }
      setNotice(SENT);
      setPicked(null);
    } catch {
      setError(offlineOrMessage(FAILED));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="reportPerson">
      <summary>{only ? `Report ${displayHandle(only)}` : "Report someone"}</summary>
      <div className="reportPerson__body">
        {target ? (
          <>
            <p>
              {`What happened with ${displayHandle(target)}? A moderator reads it. They are not told who sent it.`}
            </p>
            <div className="reportPerson__choices" role="group" aria-label={`Why you are reporting ${displayHandle(target)}`}>
              {SOCIAL_REPORT_REASONS.map((reason) => (
                <button
                  key={reason}
                  type="button"
                  className="reportPerson__action"
                  disabled={busy}
                  onClick={() => void report(target, reason)}
                >
                  {SOCIAL_REPORT_REASON_LABELS[reason]}
                </button>
              ))}
              {only ? null : (
                <button
                  type="button"
                  className="reportPerson__action"
                  data-tone="quiet"
                  disabled={busy}
                  onClick={() => setPicked(null)}
                >
                  Someone else
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <p>Who do you want to report?</p>
            <div className="reportPerson__choices" role="group" aria-label="Who you are reporting">
              {targets.map((handle) => (
                <button
                  key={handle}
                  type="button"
                  className="reportPerson__action"
                  disabled={busy}
                  onClick={() => {
                    setNotice("");
                    setPicked(handle);
                  }}
                >
                  {displayHandle(handle)}
                </button>
              ))}
            </div>
          </>
        )}
        {notice ? <p role="status">{notice}</p> : null}
        {error ? (
          <p className="reportPerson__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </details>
  );
}
