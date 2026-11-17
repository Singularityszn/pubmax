"use client";

// Host attendance on an open crew's night (migration 0247). A host or co-host marks
// each accepted guest Here or Not here. A guest sees only their own mark. A failed
// read says so and offers a retry; it never shows an empty list.

import { useCallback, useEffect, useState } from "react";

import { authedActionFetch, authedFetch } from "@/lib/authedFetch";
import { parseCrewAttendance, type CrewAttendanceDTO, type CrewAttendanceState } from "@/lib/crewAttendance";
import { displayHandle } from "@/lib/handleDisplay";
import type { SocialCrewMemberDTO } from "@/lib/socialCrew";
import { crewIdempotencyKey } from "@/lib/socialCrewsUi";

type Load = { status: "hidden" } | { status: "unavailable" } | { status: "ready"; data: CrewAttendanceDTO; beforeOpen: boolean };

const MARK_LABEL: Record<CrewAttendanceState, string> = { attended: "Here", absent: "Not here" };
const londonTime = (iso: string) => new Date(iso).toLocaleString("en-GB", {
  timeZone: "Europe/London", weekday: "short", hour: "2-digit", minute: "2-digit",
});

export default function CrewAttendance({ crewId, members, identityKey }: {
  crewId: string;
  members: SocialCrewMemberDTO[];
  identityKey: string;
}) {
  const path = `/api/social/crews/${encodeURIComponent(crewId)}/attendance`;
  const scope = `${path}|${identityKey}`;
  const [attempt, setAttempt] = useState(0);
  const request = `${scope}|${attempt}`;
  // Each answer carries the request it belongs to, so another account or crew never sees it.
  const [answer, setAnswer] = useState<{ request: string; load: Load } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ scope: string; text: string } | null>(null);
  const load = answer?.request === request ? answer.load : null;
  const said = notice?.scope === scope ? notice.text : "";

  useEffect(() => {
    const controller = new AbortController();
    const settle = (next: Load) => { if (!controller.signal.aborted) setAnswer({ request, load: next }); };
    void (async () => {
      try {
        const response = await authedFetch(path, { cache: "no-store", signal: controller.signal }, { requiresIdentity: true });
        if (response.status === 404) return settle({ status: "hidden" });
        const data = response.ok ? parseCrewAttendance(await response.json().catch(() => null)) : null;
        settle(data ? { status: "ready", data, beforeOpen: Date.now() < Date.parse(data.opensAt) } : { status: "unavailable" });
      } catch {
        settle({ status: "unavailable" });
      }
    })();
    return () => controller.abort();
  }, [path, request]);

  const mark = useCallback(async (memberId: string, state: CrewAttendanceState, expectedRevision: number, handle: string) => {
    if (saving) return;
    setSaving(memberId);
    setNotice(null);
    try {
      const response = await authedActionFetch(path, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "idempotency-key": crewIdempotencyKey("crew-attendance") },
        body: JSON.stringify({ memberId, state, expectedRevision }),
      }, { requiresIdentity: true });
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (response.ok && body && typeof body.revision === "number" && body.state === state) {
        const revision = body.revision;
        setAnswer((current) => current?.request !== request || current.load.status !== "ready" ? current
          : { request, load: { ...current.load, data: { ...current.load.data,
            items: current.load.data.items.map((item) => item.memberId !== memberId ? item
              : { ...item, state, revision, recordedAt: new Date().toISOString(), recordedBy: "host" as const }) } } });
        setNotice({ scope, text: `${displayHandle(handle)} marked ${MARK_LABEL[state].toLowerCase()}.` });
      } else if (response.status === 409 || response.status === 404) {
        setNotice({ scope, text: "That changed while you were looking. Check the list and mark again." });
        setAttempt((value) => value + 1);
      } else {
        setNotice({ scope, text: "That didn't save. Try again." });
      }
    } catch {
      setNotice({ scope, text: "That didn't save. Try again." });
    } finally {
      setSaving(null);
    }
  }, [path, request, saving, scope]);

  if (load?.status === "hidden") return null;
  if (!load) {
    return (
      <section className="crews__notice" aria-labelledby="crew-attendance-title" aria-busy="true">
        <h2 id="crew-attendance-title" className="crews__title">Who came</h2>
        <p className="crews__muted">Checking attendance…</p>
      </section>
    );
  }
  if (load.status === "unavailable") {
    return (
      <section className="crews__notice" aria-labelledby="crew-attendance-title">
        <h2 id="crew-attendance-title" className="crews__title">Who came</h2>
        <p className="crews__muted" role="alert">Attendance is unavailable right now.</p>
        <button type="button" className="crews__button" onClick={() => setAttempt((value) => value + 1)}>Try again</button>
      </section>
    );
  }

  const { data, beforeOpen } = load;
  if (!data.canAttest) {
    const own = data.items[0];
    if (!own?.state) return null;
    const who = own.recordedBy === "moderator" ? "A moderator" : "Your host";
    return (
      <section className="crews__notice" aria-labelledby="crew-attendance-title">
        <h2 id="crew-attendance-title" className="crews__title">Who came</h2>
        <p>{who} marked you {MARK_LABEL[own.state].toLowerCase()}.</p>
        <p className="crews__muted">It&rsquo;s their word, not a check. It never earns points.</p>
      </section>
    );
  }

  const handles = new Map(members.map((member) => [member.memberId, member.handle]));
  const rows = data.items.filter((item) => handles.has(item.memberId));
  const windowLine = data.open
    ? `Open until ${londonTime(data.closesAt)}.`
    : beforeOpen
      ? "Marking opens on the day."
      : "Marking has closed. A moderator can still correct a mark.";
  return (
    <section className="crews__notice" aria-labelledby="crew-attendance-title">
      <h2 id="crew-attendance-title" className="crews__title">Who came</h2>
      <p>Mark who turned up. It&rsquo;s your word as host, not a check, and it never earns points. Nobody has to buy a drink.</p>
      <p className="crews__muted">{windowLine}</p>
      {rows.length ? (
        <ul className="crews__members crews__attendance">
          {rows.map((item) => {
            const handle = handles.get(item.memberId) as string;
            return (
              <li key={item.memberId} className="crews__member">
                <span className="crews__memberHandle">{displayHandle(handle)}</span>
                <span className="crews__memberRole">
                  {item.state ? `Marked ${MARK_LABEL[item.state].toLowerCase()}${item.recordedBy === "moderator" ? " by a moderator" : ""}` : "Not marked"}
                </span>
                <span className="crews__attendanceActions" role="group" aria-label={`Attendance for ${displayHandle(handle)}`}>
                  {(["attended", "absent"] as const).map((state) => (
                    <button
                      key={state}
                      type="button"
                      className={item.state === state ? "crews__button crews__button--primary" : "crews__button"}
                      aria-pressed={item.state === state}
                      disabled={!data.open || saving !== null}
                      onClick={() => void mark(item.memberId, state, item.revision, handle)}
                    >
                      {saving === item.memberId ? "Saving…" : MARK_LABEL[state]}
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
      <p className="crews__muted" role="status" aria-live="polite">{said}</p>
    </section>
  );
}
