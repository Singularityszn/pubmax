"use client";

// "Know a regular night here? Add it": a quiet text door that opens a small
// form (kind, weekday, time, note, photo) and sends it to /api/regular-nights.
//
// WHAT IT ADDS IS A DRINKER'S DATED REPORT, never a venue fact and never
// tonight's listing. It shows with the reporter's handle, "per a drinker, seen
// <date>", until a person confirms it. A photo of the board or the poster is
// required, and the route strips its metadata before anything is stored.
//
// On a pub's own page the pub is known. On Tonight it is not, so the form asks
// for it first through the curated pub search (/api/venue-search).

import { useEffect, useId, useState, type FormEvent } from "react";

import { useViewerSession } from "@/components/auth/useViewerSession";
import SignInButton from "@/components/auth/SignInButton";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { authedActionFetch } from "@/lib/authedFetch";
import {
  REGULAR_NIGHT_REPORT_INVITE,
  REGULAR_NIGHT_REPORT_KIND_CHOICES,
  REGULAR_NIGHT_REPORT_NOTE_MAX,
  REGULAR_NIGHT_REPORT_RECEIPT,
  REGULAR_NIGHT_REPORT_SIGN_IN_LINE,
  REGULAR_NIGHT_REPORT_WEEKDAY_CHOICES,
  validateRegularNightReport,
  type RegularNightReportKind,
} from "@/lib/regularNightReports";

import "./addRegularNight.css";

const FAILED = "Couldn't send that. Try again.";
const PHOTO_LINE = "A photo of the board or the poster";
const SEARCH_MIN = 2;

type Phase = "closed" | "open" | "sending" | "sent";
type PubChoice = { id: string; name: string; area: string };

function usePubSearch(query: string, enabled: boolean): PubChoice[] {
  const [hits, setHits] = useState<{ query: string; pubs: PubChoice[] }>({ query: "", pubs: [] });
  const trimmed = query.trim();
  useEffect(() => {
    if (!enabled || trimmed.length < SEARCH_MIN) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetch(`/api/venue-search?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: unknown) => {
          const venues = (body as { venues?: unknown } | null)?.venues;
          const pubs = Array.isArray(venues)
            ? venues.filter(
                (venue): venue is PubChoice =>
                  Boolean(venue) && typeof (venue as PubChoice).id === "string" && typeof (venue as PubChoice).name === "string",
              )
            : [];
          setHits({ query: trimmed, pubs });
        })
        .catch(() => {
          if (!controller.signal.aborted) setHits({ query: trimmed, pubs: [] });
        });
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [enabled, trimmed]);
  return enabled && hits.query === trimmed ? hits.pubs : [];
}

export default function AddRegularNight({
  venueId,
  venueName,
  where,
}: {
  /** The pub, when the surface already knows it. Absent on Tonight, where the form asks. */
  venueId?: string;
  venueName?: string;
  /** Which surface it sits on, for test hooks. */
  where: "tonight" | "pub";
}): React.JSX.Element {
  const { signedIn, unresolved } = useViewerSession();
  const [phase, setPhase] = useState<Phase>("closed");
  const [pub, setPub] = useState<PubChoice | null>(venueId ? { id: venueId, name: venueName ?? "", area: "" } : null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<RegularNightReportKind | "">("");
  const [weekday, setWeekday] = useState("");
  const [startTime, setStartTime] = useState("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState("");
  const formId = useId();
  const pubs = usePubSearch(query, phase !== "closed" && !venueId && !pub);

  function close() {
    setPhase("closed");
    setPub(venueId ? { id: venueId, name: venueName ?? "", area: "" } : null);
    setQuery("");
    setKind("");
    setWeekday("");
    setStartTime("");
    setNote("");
    setPhoto(null);
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase === "sending") return;
    const checked = validateRegularNightReport({ venueId: pub?.id ?? "", kind, weekday, startTime, note });
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    if (!photo) {
      setError("Add a photo of the board or the poster.");
      return;
    }
    const body = new FormData();
    body.set("venueId", checked.venueId);
    body.set("kind", checked.kind);
    body.set("weekday", String(checked.weekday));
    if (checked.startTime) body.set("startTime", checked.startTime);
    if (checked.note) body.set("note", checked.note);
    body.set("photo", photo);
    setPhase("sending");
    setError("");
    try {
      const response = await authedActionFetch(
        "/api/regular-nights",
        { method: "POST", body },
        { requiresIdentity: true },
      );
      if (!response.ok) {
        const answer: unknown = await response.json().catch(() => null);
        setError(offlineOrMessage(errorMessageFrom(answer, FAILED)));
        setPhase("open");
        return;
      }
      setPhase("sent");
    } catch {
      setError(offlineOrMessage(FAILED));
      setPhase("open");
    }
  }

  if (phase === "closed") {
    return (
      <button
        type="button"
        className="addRegularNightDoor"
        data-add-regular-night={where}
        aria-expanded="false"
        onClick={() => setPhase("open")}
      >
        {REGULAR_NIGHT_REPORT_INVITE}
      </button>
    );
  }

  if (phase === "sent") {
    return (
      <p className="addRegularNightLine" role="status" data-add-regular-night={where}>
        {REGULAR_NIGHT_REPORT_RECEIPT}
      </p>
    );
  }

  if (!signedIn) {
    return (
      <div className="addRegularNightForm" data-add-regular-night={where}>
        <p className="addRegularNightLine">{unresolved ? "Checking your account." : REGULAR_NIGHT_REPORT_SIGN_IN_LINE}</p>
        {unresolved ? null : <SignInButton />}
        <button type="button" className="addRegularNightCancel" onClick={close}>
          Not now
        </button>
      </div>
    );
  }

  const sending = phase === "sending";
  return (
    <form
      className="addRegularNightForm"
      data-add-regular-night={where}
      aria-labelledby={`${formId}-title`}
      onSubmit={(event) => void submit(event)}
    >
      <p className="addRegularNightTitle" id={`${formId}-title`}>
        {pub?.name ? `A regular night at ${pub.name}` : "A regular night"}
      </p>
      {!venueId ? (
        pub ? (
          <p className="addRegularNightLine">
            {pub.name}
            {pub.area ? `, ${pub.area}` : ""}{" "}
            <button type="button" className="addRegularNightCancel" onClick={() => setPub(null)} disabled={sending}>
              Change pub
            </button>
          </p>
        ) : (
          <div className="addRegularNightField">
            <label htmlFor={`${formId}-pub`}>Which pub</label>
            <input
              id={`${formId}-pub`}
              type="search"
              value={query}
              autoComplete="off"
              disabled={sending}
              onChange={(event) => setQuery(event.target.value)}
            />
            {pubs.length > 0 ? (
              <ul className="addRegularNightPubs" aria-label="Pubs that match">
                {pubs.map((hit) => (
                  <li key={hit.id}>
                    <button type="button" className="addRegularNightPub" onClick={() => setPub(hit)}>
                      {hit.name}
                      {hit.area ? `, ${hit.area}` : ""}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )
      ) : null}
      <div className="addRegularNightField">
        <label htmlFor={`${formId}-kind`}>What night</label>
        <select
          id={`${formId}-kind`}
          value={kind}
          disabled={sending}
          onChange={(event) => setKind(event.target.value as RegularNightReportKind | "")}
        >
          <option value="">Choose one</option>
          {REGULAR_NIGHT_REPORT_KIND_CHOICES.map((choice) => (
            <option key={choice.kind} value={choice.kind}>
              {choice.label}
            </option>
          ))}
        </select>
      </div>
      <div className="addRegularNightRow">
        <div className="addRegularNightField">
          <label htmlFor={`${formId}-weekday`}>Every</label>
          <select
            id={`${formId}-weekday`}
            value={weekday}
            disabled={sending}
            onChange={(event) => setWeekday(event.target.value)}
          >
            <option value="">Choose a day</option>
            {REGULAR_NIGHT_REPORT_WEEKDAY_CHOICES.map((choice) => (
              <option key={choice.weekday} value={String(choice.weekday)}>
                {choice.label}
              </option>
            ))}
          </select>
        </div>
        <div className="addRegularNightField">
          <label htmlFor={`${formId}-time`}>Starts (optional)</label>
          <input
            id={`${formId}-time`}
            type="time"
            value={startTime}
            disabled={sending}
            onChange={(event) => setStartTime(event.target.value)}
          />
        </div>
      </div>
      <div className="addRegularNightField">
        <label htmlFor={`${formId}-note`}>A line about it (optional)</label>
        <input
          id={`${formId}-note`}
          type="text"
          value={note}
          maxLength={REGULAR_NIGHT_REPORT_NOTE_MAX}
          disabled={sending}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
      <div className="addRegularNightField">
        <label htmlFor={`${formId}-photo`}>{PHOTO_LINE}</label>
        <input
          id={`${formId}-photo`}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-required="true"
          disabled={sending}
          onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
        />
      </div>
      {error ? (
        <p className="addRegularNightLine" role="alert">
          {error}
        </p>
      ) : null}
      <div className="addRegularNightActions">
        <button type="submit" className="addRegularNightSend" disabled={sending}>
          {sending ? "Sending…" : "Send"}
        </button>
        <button type="button" className="addRegularNightCancel" onClick={close}>
          Not now
        </button>
      </div>
    </form>
  );
}
