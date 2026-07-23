"use client";

// Visit Report panel (Wayfinder 3.4) — renders on the venue sheet ALONGSIDE the
// star ratings (never replacing them). Two honest layers:
//   • the recency-weighted SUMMARY — plain lines ("Usually steady, most would
//     return"), NO star score, shown only past the report floor. Value first:
//     this always renders when there is signal, before any ask.
//   • the compact three-tap CAPTURE card (busyness, would-return, price sanity,
//     optional note) — dismissible, and it respects the shared one-prompt-per-
//     session budget (lib/promptBudget) so it never stacks on the A2HS / tour /
//     identity-nudge surfaces. If the budget is already spent it stays a quiet
//     "Add a visit report" link (a user tap, not an interruption).
//
// Duty of care: rates the pub and the night, never the drinker.

import { useEffect, useState } from "react";

import {
  BUSYNESS_VALUES,
  PRICE_SANITY_VALUES,
  VISIT_REPORT_PROMPT_SURFACE,
  WOULD_RETURN_VALUES,
  type Busyness,
  type PriceSanity,
  type WouldReturn,
} from "@/lib/visitReports";
import type { VisitReportSummary } from "@/lib/visitReportSummary";
import { claimPromptBudget, hasPromptBudgetFor } from "@/lib/promptBudget";

import {
  fetchVisitReports,
  postVisitReport,
  rememberHandle,
  storedHandle,
} from "./visitReportsClient";

import "./visitReports.css";

export type VisitReportPanelProps = {
  venueId: string;
  venueName: string;
};

const BUSYNESS_LABELS: Record<Busyness, string> = {
  quiet: "Quiet",
  steady: "Steady",
  rammed: "Rammed",
};
const RETURN_LABELS: Record<WouldReturn, string> = {
  yes: "Would return",
  no: "Wouldn't",
};
const PRICE_LABELS: Record<PriceSanity, string> = {
  fine: "Price fine",
  steep: "Bit steep",
};

const MAX_NOTE = 140;

export default function VisitReportPanel({ venueId, venueName }: VisitReportPanelProps) {
  const [summary, setSummary] = useState<VisitReportSummary | null>(null);
  const [handle, setHandle] = useState("");
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const [busyness, setBusyness] = useState<Busyness | null>(null);
  const [wouldReturn, setWouldReturn] = useState<WouldReturn | null>(null);
  const [priceSanity, setPriceSanity] = useState<PriceSanity | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(async () => {
      const read = await fetchVisitReports(venueId);
      if (cancelled) return;
      setHandle(storedHandle());
      if (read) setSummary(read.summary);
      // Auto-open the ask ONLY if this session's prompt budget is free — and
      // claim it the moment we do, so a sibling surface can't also prompt.
      if (hasPromptBudgetFor(VISIT_REPORT_PROMPT_SURFACE) && claimPromptBudget(VISIT_REPORT_PROMPT_SURFACE)) {
        if (!cancelled) setOpen(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [venueId]);

  const hasDraft = busyness !== null || wouldReturn !== null || priceSanity !== null || note.trim() !== "";

  const submit = async () => {
    const clean = handle.trim();
    if (!clean) {
      setFeedback({ kind: "error", text: "Add a handle first. Your report needs a name." });
      return;
    }
    if (!hasDraft) {
      setFeedback({ kind: "error", text: "Tap at least one detail about your visit." });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      await postVisitReport({ venueId, handle: clean, busyness, wouldReturn, priceSanity, note: note.trim() });
      rememberHandle(clean);
      const read = await fetchVisitReports(venueId);
      if (read) setSummary(read.summary);
      setBusyness(null);
      setWouldReturn(null);
      setPriceSanity(null);
      setNote("");
      setOpen(false);
      setFeedback({ kind: "ok", text: "Thanks. Your visit helps the next round." });
    } catch (err) {
      setFeedback({
        kind: "error",
        text: err instanceof Error ? err.message : "Couldn't save your report just now.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="visitReportPanel" aria-label={`Visit reports for ${venueName}`}>
      <span className="visitReportLabel">On the night</span>

      {summary?.shown ? (
        <div className="visitReportSummary">
          <p className="visitReportHeadline">{summary.headline}</p>
          {summary.lines.length > 0 ? (
            <ul className="visitReportLines">
              {summary.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <p className="visitReportEmpty">No visit reports yet. Be the first to log how it was.</p>
      )}

      {dismissed ? null : open ? (
        <div className="visitReportCard">
          <div className="visitReportCardHead">
            <span className="visitReportCardTitle">How was {venueName}?</span>
            <button
              type="button"
              className="visitReportDismiss"
              aria-label="Dismiss visit report"
              onClick={() => {
                setOpen(false);
                setDismissed(true);
              }}
            >
              ×
            </button>
          </div>

          <div className="visitReportChips" role="group" aria-label="How busy">
            {BUSYNESS_VALUES.map((value) => (
              <button
                key={value}
                type="button"
                className={busyness === value ? "visitChip active" : "visitChip"}
                aria-pressed={busyness === value}
                onClick={() => setBusyness((cur) => (cur === value ? null : value))}
              >
                {BUSYNESS_LABELS[value]}
              </button>
            ))}
          </div>

          <div className="visitReportChips" role="group" aria-label="Would you return">
            {WOULD_RETURN_VALUES.map((value) => (
              <button
                key={value}
                type="button"
                className={wouldReturn === value ? "visitChip active" : "visitChip"}
                aria-pressed={wouldReturn === value}
                onClick={() => setWouldReturn((cur) => (cur === value ? null : value))}
              >
                {RETURN_LABELS[value]}
              </button>
            ))}
          </div>

          <div className="visitReportChips" role="group" aria-label="Price sanity">
            {PRICE_SANITY_VALUES.map((value) => (
              <button
                key={value}
                type="button"
                className={priceSanity === value ? "visitChip active" : "visitChip"}
                aria-pressed={priceSanity === value}
                onClick={() => setPriceSanity((cur) => (cur === value ? null : value))}
              >
                {PRICE_LABELS[value]}
              </button>
            ))}
          </div>

          <textarea
            className="visitReportNote"
            value={note}
            onChange={(event) => setNote(event.target.value.slice(0, MAX_NOTE))}
            maxLength={MAX_NOTE}
            rows={2}
            placeholder="Optional: one line on the night (no essays)"
            aria-label="Optional note"
          />

          {storedHandle() ? null : (
            <input
              className="visitReportHandle"
              type="text"
              value={handle}
              onChange={(event) => setHandle(event.target.value)}
              placeholder="your handle"
              aria-label="Handle to report as"
            />
          )}

          <button type="button" className="visitReportSubmit" onClick={() => void submit()} disabled={saving}>
            {saving ? "Saving…" : "Add visit report"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="visitReportOpen"
          onClick={() => {
            setDismissed(false);
            setOpen(true);
          }}
        >
          Add a visit report
        </button>
      )}

      {feedback ? (
        <span className={feedback.kind === "error" ? "visitReportError" : "visitReportOk"} role="status">
          {feedback.text}
        </span>
      ) : null}
    </section>
  );
}
