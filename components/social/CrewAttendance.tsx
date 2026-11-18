"use client";

// Host attendance on an open crew's night (migration 0247). A host or co-host marks
// each guest Here or Not here. A guest sees only their own mark, and nothing while it
// loads or fails, and can report that mark to a moderator who was not in the crew.
// A host's failed read says so and offers a retry, never an empty list.
// lib/crewAttendanceView owns the lifecycle; this file only renders it.

import { useCallback, useEffect, useReducer, useState } from "react";

import { authedActionFetch, authedFetch } from "@/lib/authedFetch";
import {
  crewAttendanceRefusal, isCrewAttendanceReportOutcome, parseCrewAttendance, type CrewAttendanceState,
} from "@/lib/crewAttendance";
import { CREW_ATTENDANCE_LOADING, nextCrewAttendanceView, type CrewAttendanceNotice } from "@/lib/crewAttendanceView";
import { afterCrewAttendanceWrite, holdCrewAttendanceWrite } from "@/lib/crewAttendanceWrites";
import { displayHandle } from "@/lib/handleDisplay";
import type { SocialCrewMemberDTO } from "@/lib/socialCrew";
import { crewIdempotencyKey } from "@/lib/socialCrewsUi";
import { useRefreshAt } from "@/lib/useRefreshAt";

const MARK_LABEL: Record<CrewAttendanceState, string> = { attended: "Here", absent: "Not here" };
const REFUSED: Record<string, string> = {
  stale: "That changed while you were looking. Check the list and mark again.",
  closed: "Marking closed before that saved. A moderator can still correct a mark.",
  not_open: "Marking has not opened yet. It opens on the day.",
};
const REPORT_LINE = {
  sending: "",
  reported: "Reported. A moderator who wasn’t in this crew checks it.",
  decided: "A moderator has already checked this mark.",
  stale: "Your mark changed. Check it, then report it if it’s wrong.",
  failed: "That report did not send. Try again.",
} as const;
type GuestReport = { revision: number; status: keyof typeof REPORT_LINE };
const londonTime = (iso: string) => new Date(iso).toLocaleString("en-GB", {
  timeZone: "Europe/London", weekday: "short", hour: "2-digit", minute: "2-digit",
});

type Props = { crewId: string; members: SocialCrewMemberDTO[]; hosts: boolean };

/** One panel per crew and signed-in account, so another account never sees this state. */
export default function CrewAttendance({ identityKey, ...props }: Props & { identityKey: string }) {
  const scope = `${props.crewId}|${identityKey}`;
  return <AttendancePanel key={scope} scope={scope} {...props} />;
}

function AttendancePanel({ crewId, members, hosts, scope }: Props & { scope: string }) {
  const path = `/api/social/crews/${encodeURIComponent(crewId)}/attendance`;
  const roster = members.map(({ memberId, role }) => `${memberId}:${role}`).sort().join(",");
  const [view, dispatch] = useReducer(nextCrewAttendanceView, CREW_ATTENDANCE_LOADING);
  const [attempt, setAttempt] = useState(0);
  const [report, setReport] = useState<GuestReport | null>(null);
  const reload = useCallback(() => {
    dispatch({ type: "refresh" });
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        // A mark this account still has in flight on this crew lands before the read.
        await afterCrewAttendanceWrite(scope);
        if (controller.signal.aborted) return;
        dispatch({ type: "refresh" });
        const response = await authedFetch(path, { cache: "no-store", signal: controller.signal }, { requiresIdentity: true });
        const data = response.ok ? parseCrewAttendance(await response.json().catch(() => null)) : null;
        if (controller.signal.aborted) return;
        if (response.status === 404) dispatch({ type: "missing" });
        else dispatch(data ? { type: "loaded", data, now: Date.now() } : { type: "failed" });
      } catch {
        if (!controller.signal.aborted) dispatch({ type: "failed" });
      }
    })();
    return () => controller.abort();
  }, [path, attempt, scope, roster, hosts]);

  useRefreshAt(view.status === "ready" ? view.boundary : null, view.status === "ready" || view.status === "unavailable", reload);

  const handles = new Map(members.map((member) => [member.memberId, member.handle]));

  const mark = useCallback(async (memberId: string, state: CrewAttendanceState, expectedRevision: number) => {
    if (view.status !== "ready" || view.saving || view.refreshing || !view.data.open) return;
    dispatch({ type: "save", memberId, state });
    try {
      const response = await holdCrewAttendanceWrite(scope, authedActionFetch(path, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "idempotency-key": crewIdempotencyKey("crew-attendance") },
        body: JSON.stringify({ memberId, state, expectedRevision }),
      }, { requiresIdentity: true }));
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (response.ok && body && typeof body.revision === "number" && body.state === state) {
        dispatch({ type: "saved", memberId, state, revision: body.revision, now: Date.now() });
      } else if (response.status === 409 || response.status === 404) {
        // A 404 is a guest who left or lost access. Reading again shows what is true now.
        dispatch({ type: "refused", reason: crewAttendanceRefusal(body) ?? "stale" });
        setAttempt((value) => value + 1);
      } else {
        dispatch({ type: "saveFailed" });
      }
    } catch {
      dispatch({ type: "saveFailed" });
    }
  }, [path, scope, view]);

  const reportMark = useCallback(async (revision: number) => {
    setReport({ revision, status: "sending" });
    try {
      const response = await authedActionFetch(`${path}/report`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision }),
      }, { requiresIdentity: true });
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (response.ok && body && isCrewAttendanceReportOutcome(body.code) && body.revision === revision) {
        setReport({ revision, status: body.code });
      } else if (response.status === 409 || response.status === 404) {
        // The mark changed or went. Reading again shows the one to report.
        setReport({ revision, status: "stale" });
        reload();
      } else {
        setReport({ revision, status: "failed" });
      }
    } catch {
      setReport({ revision, status: "failed" });
    }
  }, [path, reload]);

  const noticeText = (notice: CrewAttendanceNotice | null) => {
    if (!notice) return "";
    if (notice.kind === "failed") return "That didn't save. Try again.";
    if (notice.kind === "refused") return REFUSED[notice.reason];
    return `${displayHandle(handles.get(notice.memberId) ?? "")} marked ${MARK_LABEL[notice.state].toLowerCase()}.`;
  };

  if (view.status === "hidden") return null;
  if (view.status === "loading") {
    if (!hosts) return null;
    return (
      <section className="crews__notice" aria-labelledby="crew-attendance-title" aria-busy="true">
        <h2 id="crew-attendance-title" className="crews__title">Who came</h2>
        <p className="crews__muted">Checking attendance…</p>
      </section>
    );
  }
  if (view.status === "unavailable") {
    if (!hosts) return null;
    return (
      <section className="crews__notice" aria-labelledby="crew-attendance-title">
        <h2 id="crew-attendance-title" className="crews__title">Who came</h2>
        <p className="crews__muted" role="alert">Attendance is unavailable right now.</p>
        <button type="button" className="crews__button" onClick={reload}>Try again</button>
      </section>
    );
  }

  const { data, beforeOpen, saving, refreshing, notice } = view;
  if (!data.canAttest) {
    const own = data.items[0];
    if (!own?.state) return null;
    const who = own.recordedBy === "moderator" ? "A moderator" : "Your host";
    // A report answers for the revision it named. A changed mark offers a new report.
    const shown = report && (report.revision === own.revision || report.status === "stale") ? report : null;
    const sending = shown?.status === "sending";
    const filed = shown?.status === "reported" || shown?.status === "decided";
    return (
      <section className="crews__notice" aria-labelledby="crew-attendance-title">
        <h2 id="crew-attendance-title" className="crews__title">Who came</h2>
        <p>{who} marked you {MARK_LABEL[own.state].toLowerCase()}.</p>
        <p className="crews__muted">It&rsquo;s their word, not a check, and it never earns points. If it&rsquo;s wrong, report it.</p>
        <div className="crews__formActions">
          <button
            type="button"
            className="crews__button"
            aria-disabled={sending || filed || refreshing || undefined}
            onClick={() => {
              if (!sending && !filed && !refreshing) void reportMark(own.revision);
            }}
          >
            {sending ? "Sending…" : filed ? "Reported" : "Report this mark"}
          </button>
        </div>
        <p className="crews__muted" role="status" aria-live="polite">{shown ? REPORT_LINE[shown.status] : ""}</p>
      </section>
    );
  }

  const rows = data.items.filter((item) => handles.has(item.memberId));
  const windowLine = data.open
    ? `Open until ${londonTime(data.closesAt)}.`
    : beforeOpen
      ? "Marking opens on the day."
      : "Marking has closed. A moderator can still correct a mark.";
  const blocked = !data.open || saving !== null || refreshing;
  return (
    <section className="crews__notice" aria-labelledby="crew-attendance-title">
      <h2 id="crew-attendance-title" className="crews__title">Who came</h2>
      <p>Mark who turned up. It&rsquo;s your word as host, not a check, and it never earns points. Nobody has to buy a drink.</p>
      <p className="crews__muted">{windowLine}</p>
      {rows.length ? (
        <ul className="crews__members crews__attendance" aria-busy={refreshing || undefined}>
          {rows.map((item) => {
            const handle = displayHandle(handles.get(item.memberId) as string);
            return (
              <li key={item.memberId} className="crews__member">
                <span className="crews__memberHandle">{handle}</span>
                <span className="crews__memberRole">
                  {item.state ? `Marked ${MARK_LABEL[item.state].toLowerCase()}${item.recordedBy === "moderator" ? " by a moderator" : ""}` : "Not marked"}
                </span>
                <span className="crews__attendanceActions" role="group" aria-label={`Attendance for ${handle}`}>
                  {(["attended", "absent"] as const).map((state) => (
                    <button
                      key={state}
                      type="button"
                      className={item.state === state ? "crews__button crews__button--primary" : "crews__button"}
                      aria-pressed={item.state === state}
                      aria-disabled={blocked || undefined}
                      onClick={() => void mark(item.memberId, state, item.revision)}
                    >
                      {saving?.memberId === item.memberId && saving.state === state ? "Saving…" : MARK_LABEL[state]}
                    </button>
                  ))}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="crews__muted">Nobody else is in yet.</p>
      )}
      <p className="crews__muted" role="status" aria-live="polite">{noticeText(notice)}</p>
    </section>
  );
}
