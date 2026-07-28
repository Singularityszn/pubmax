"use client";

// One Visit Report surface for every venue page. It reads individual,
// contributor-attributed accounts newest first and opens one compact composer.
// A row is a claim about one dated visit, never a score or verified venue fact.

import { useEffect, useRef, useState } from "react";

import {
  BUSYNESS_VALUES,
  londonEveningKey,
  MAX_VISIT_NOTE,
  NOISE_VALUES,
  SEATING_VALUES,
  SERVICE_WAIT_VALUES,
  type Busyness,
  type Noise,
  type Seating,
  type ServiceWait,
  type VisitReportDTO,
} from "@/lib/visitReports";

import {
  fetchVisitReports,
  postVisitReport,
  rememberHandle,
  reportVisitReport,
  storedHandle,
  type VisitReportVenueRead,
} from "./visitReportsClient";

import "./visitReports.css";

export type VisitReportPanelProps = {
  venueId: string;
  venueName: string;
  /**
   * False while the panel is mounted but out of view (a tab the viewer hasn't
   * opened). It defers the venue read until the surface is first looked at; it
   * never unmounts, so a half-written account survives a trip to another tab.
   */
  active?: boolean;
};

const BUSYNESS_LABELS: Record<Busyness, string> = {
  quiet: "Quiet",
  steady: "Steady",
  rammed: "Rammed",
};

const NOISE_LABELS: Record<Noise, string> = {
  "easy-to-talk": "Easy to talk",
  loud: "Loud",
  "had-to-shout": "Had to shout",
};

const SEATING_LABELS: Record<Seating, string> = {
  plenty: "Plenty",
  tight: "Tight",
  standing: "Standing",
};

const SERVICE_WAIT_LABELS: Record<ServiceWait, string> = {
  quick: "Quick",
  "some-wait": "Some wait",
  long: "Long wait",
};

function visitDayLabel(day: string): string {
  const parsed = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return day;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

function reportDetails(report: VisitReportDTO): string[] {
  return [
    report.busyness ? `Crowd: ${BUSYNESS_LABELS[report.busyness].toLowerCase()}` : "",
    report.noise ? `Noise: ${NOISE_LABELS[report.noise].toLowerCase()}` : "",
    report.seating ? `Seats: ${SEATING_LABELS[report.seating].toLowerCase()}` : "",
    report.serviceWait
      ? `Bar wait: ${SERVICE_WAIT_LABELS[report.serviceWait].toLowerCase()}`
      : "",
  ].filter(Boolean);
}

function VisitReportRow({
  report,
  flagged,
  flagging,
  onFlag,
}: {
  report: VisitReportDTO;
  flagged: boolean;
  flagging: boolean;
  onFlag: (id: string) => void;
}) {
  const details = reportDetails(report);
  return (
    <article className="visitReportRow">
      <p className="visitReportByline">
        <strong>@{report.handle}</strong>
        <span aria-hidden="true"> · </span>
        <time dateTime={report.visitedAt}>Visited {visitDayLabel(report.visitedAt)}</time>
      </p>
      {report.note ? <p className="visitReportAccount">{report.note}</p> : null}
      {details.length > 0 ? (
        <ul className="visitReportFacts" aria-label="What they found">
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
      <button
        type="button"
        className="visitReportFlag"
        disabled={flagged || flagging}
        onClick={() => onFlag(report.id)}
        aria-label={`Report ${report.handle}'s visit account`}
      >
        {flagged ? "Reported" : flagging ? "Reporting…" : "Report"}
      </button>
    </article>
  );
}

function ChoiceGroup<T extends string>({
  label,
  values,
  labels,
  selected,
  onSelect,
}: {
  label: string;
  values: readonly T[];
  labels: Record<T, string>;
  selected: T | null;
  onSelect: (value: T | null) => void;
}) {
  return (
    <fieldset className="visitReportChoiceGroup">
      <legend>{label}</legend>
      <div className="visitReportChips">
        {values.map((value) => (
          <button
            key={value}
            type="button"
            className={selected === value ? "visitChip active" : "visitChip"}
            aria-pressed={selected === value}
            onClick={() => onSelect(selected === value ? null : value)}
          >
            {labels[value]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

// A panel belongs to ONE pub, so the venue is its identity, not a prop it
// re-reads. Keying the mount means a pin switch on the map sheet drops the
// previous pub's accounts, flags, feedback line, half-typed draft and any
// in-flight write together, rather than showing them under the new pub's name.
export default function VisitReportPanel({
  venueId,
  venueName,
  active = true,
}: VisitReportPanelProps) {
  return (
    <VenueVisitReports
      key={venueId}
      venueId={venueId}
      venueName={venueName}
      active={active}
    />
  );
}

function VenueVisitReports({ venueId, venueName, active = true }: VisitReportPanelProps) {
  const tonight = londonEveningKey(new Date());
  const [read, setRead] = useState<VisitReportVenueRead | null>(null);
  const [handle, setHandle] = useState("");
  const [handleRemembered, setHandleRemembered] = useState(false);
  const [open, setOpen] = useState(false);
  const [visitedAt, setVisitedAt] = useState(tonight);
  const [busyness, setBusyness] = useState<Busyness | null>(null);
  const [noise, setNoise] = useState<Noise | null>(null);
  const [seating, setSeating] = useState<Seating | null>(null);
  const [serviceWait, setServiceWait] = useState<ServiceWait | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [flaggingId, setFlaggingId] = useState<string | null>(null);
  const [flaggedIds, setFlaggedIds] = useState<Set<string>>(() => new Set());
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; text: string } | null>(
    null,
  );

  const requested = useRef(false);

  useEffect(() => {
    if (!active || requested.current) return;
    requested.current = true;
    let cancelled = false;
    void Promise.resolve().then(async () => {
      const remembered = storedHandle();
      const nextRead = await fetchVisitReports(venueId);
      if (cancelled) return;
      setHandle(remembered);
      setHandleRemembered(Boolean(remembered));
      setRead(nextRead ?? { status: "degraded", reports: [] });
    });
    return () => {
      cancelled = true;
    };
  }, [active, venueId]);

  const hasDraft =
    busyness !== null ||
    noise !== null ||
    seating !== null ||
    serviceWait !== null ||
    note.trim() !== "";

  async function submit() {
    const cleanHandle = handle.trim();
    if (!cleanHandle) {
      setFeedback({ kind: "error", text: "Add your handle. This account needs a name." });
      return;
    }
    if (!visitedAt) {
      setFeedback({ kind: "error", text: "Add the day you were there." });
      return;
    }
    if (!hasDraft) {
      setFeedback({ kind: "error", text: "Add one thing you found on the visit." });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      await postVisitReport({
        venueId,
        handle: cleanHandle,
        visitedAt,
        busyness,
        noise,
        seating,
        serviceWait,
        note: note.trim(),
      });
      rememberHandle(cleanHandle);
      setHandleRemembered(true);
      const nextRead = await fetchVisitReports(venueId);
      setRead(nextRead ?? { status: "degraded", reports: [] });
      setBusyness(null);
      setNoise(null);
      setSeating(null);
      setServiceWait(null);
      setNote("");
      setOpen(false);
      setFeedback({ kind: "ok", text: "Saved. Your visit is on this pub's page." });
    } catch (error) {
      setFeedback({
        kind: "error",
        text: error instanceof Error ? error.message : "Couldn't save this visit just now.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function flag(id: string) {
    setFlaggingId(id);
    setFeedback(null);
    try {
      await reportVisitReport(id);
      setFlaggedIds((current) => new Set(current).add(id));
      setFeedback({ kind: "ok", text: "Reported for a moderator to check." });
    } catch (error) {
      setFeedback({
        kind: "error",
        text: error instanceof Error ? error.message : "Couldn't report this visit just now.",
      });
    } finally {
      setFlaggingId(null);
    }
  }

  return (
    <section className="visitReportPanel" aria-labelledby={`visitReports-${venueId}`}>
      <div className="visitReportHead">
        <div>
          <span className="visitReportLabel">On the night</span>
          <h3 id={`visitReports-${venueId}`} className="visitReportTitle">
            Visits, written up
          </h3>
        </div>
        {!open ? (
          <button type="button" className="visitReportOpen" onClick={() => setOpen(true)}>
            Write yours
          </button>
        ) : null}
      </div>

      {read === null ? (
        <p className="visitReportEmpty" role="status">
          Checking visit notes.
        </p>
      ) : read.reports.length > 0 ? (
        <div className="visitReportList">
          {read.reports.map((report) => (
            <VisitReportRow
              key={report.id}
              report={report}
              flagged={flaggedIds.has(report.id)}
              flagging={flaggingId === report.id}
              onFlag={(id) => void flag(id)}
            />
          ))}
        </div>
      ) : read.status === "ready" ? (
        <p className="visitReportEmpty">No visits have been written up here yet.</p>
      ) : (
        <p className="visitReportEmpty">We couldn&apos;t check the visit notes here just now.</p>
      )}

      {open ? (
        <div className="visitReportCard">
          <div className="visitReportCardHead">
            <div>
              <span className="visitReportCardTitle">What was {venueName} like?</span>
              <p>Pick what you saw. Add one short line if it helps.</p>
            </div>
            <button
              type="button"
              className="visitReportDismiss"
              aria-label="Close visit report"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>

          <label className="visitReportDate">
            <span>When were you there?</span>
            <input
              type="date"
              value={visitedAt}
              max={tonight}
              onChange={(event) => setVisitedAt(event.target.value)}
            />
          </label>

          <ChoiceGroup
            label="How busy?"
            values={BUSYNESS_VALUES}
            labels={BUSYNESS_LABELS}
            selected={busyness}
            onSelect={setBusyness}
          />
          <ChoiceGroup
            label="Could you hear each other?"
            values={NOISE_VALUES}
            labels={NOISE_LABELS}
            selected={noise}
            onSelect={setNoise}
          />
          <ChoiceGroup
            label="Finding a seat?"
            values={SEATING_VALUES}
            labels={SEATING_LABELS}
            selected={seating}
            onSelect={setSeating}
          />
          <ChoiceGroup
            label="Wait at the bar?"
            values={SERVICE_WAIT_VALUES}
            labels={SERVICE_WAIT_LABELS}
            selected={serviceWait}
            onSelect={setServiceWait}
          />

          <label className="visitReportNoteWrap">
            <span>One short account</span>
            <textarea
              className="visitReportNote"
              value={note}
              onChange={(event) => setNote(event.target.value.slice(0, MAX_VISIT_NOTE))}
              maxLength={MAX_VISIT_NOTE}
              rows={3}
              placeholder="What did you find when you walked in?"
            />
            <small>{MAX_VISIT_NOTE - note.length} characters left</small>
          </label>

          {!handleRemembered ? (
            <label className="visitReportHandleWrap">
              <span>Your contributor handle</span>
              <input
                className="visitReportHandle"
                type="text"
                value={handle}
                onChange={(event) => setHandle(event.target.value)}
                placeholder="your_handle"
                autoComplete="nickname"
                maxLength={40}
              />
            </label>
          ) : null}

          <button
            type="button"
            className="visitReportSubmit"
            onClick={() => void submit()}
            disabled={saving}
          >
            {saving ? "Saving…" : "Add visit account"}
          </button>
          <p className="visitReportTrust">
            This is your account of one visit. It is shown with your handle and the day,
            not as a checked fact about the pub.
          </p>
        </div>
      ) : null}

      {feedback ? (
        <p
          className={feedback.kind === "error" ? "visitReportError" : "visitReportOk"}
          role={feedback.kind === "error" ? "alert" : "status"}
        >
          {feedback.text}
        </p>
      ) : null}
    </section>
  );
}
