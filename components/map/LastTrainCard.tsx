"use client";

// "Last Pint" card — the signature utility (PRD user stories 19-24). Given a
// venue's coordinates, it fetches the nearest Tube/rail station, a pub-native
// decision ("Order one more" ... "Train risk tonight"), next departures + the
// last train per line, any disruption, and the 3 nearest pubs to the station
// for a final pint by the platform. Wired into the venue panel by the
// orchestrator (VenueInspector) — this file does NOT render itself anywhere.
//
// React 19 rules: the fetch fires in an effect but setState only ever runs
// inside the async resolution/catch (never the effect body). AbortController
// cancels the request on unmount. Provenance-honest: live copy is scoped to
// live departures only, while the Last Pint decision stays timetable-based; TfL
// failures get a warm fallback instead of a broken or blank card.
//
// Styling: inline style objects, matching the rest of components/map/** (no
// CSS module/import convention exists in this codebase — see styles below).

import { useEffect, useId, useState } from "react";

import {
  lastTrainFetchUrl,
  readLastTrainDestination,
  writeLastTrainDestination,
} from "@/lib/lastTrainDestination";
import type { LastPintDecision, LastPintDecisionKind, LastTrainResult } from "@/lib/tfl";

type LastTrainCardProps = {
  lat: number;
  lng: number;
  venueName?: string;
  // Optional: when provided, tapping one of the 3 station pubs calls this
  // instead of just rendering a plain list. Backward-compatible — VenueInspector
  // (owned by another wave) doesn't pass this today and doesn't need to.
  onSelectVenue?: (venueId: string) => void;
  // Optional: lifts the live Last Pint decision up to the orchestrator so the
  // Pints tab can stamp each drop with an honest "before/after the last train"
  // badge (IDEAS A5). This card KEEPS ownership of the fetch — it just publishes
  // the resolved decision (or null while loading / on TfL failure). Because the
  // fetch only fires from this card's effect, the decision is unknown until the
  // user opens the Getting-home tab; no badges render before then, by design.
  onDecision?: (decision: LastPintDecision | null) => void;
};

export type LastTrainCardState =
  | { status: "loading" }
  | { status: "ready"; requestKey: string; data: LastTrainResult }
  | { status: "empty"; requestKey: string };

export function lastTrainRequestKey({
  lat,
  lng,
  venueName,
  destination = "",
}: {
  lat: number;
  lng: number;
  venueName?: string;
  destination?: string;
}): string {
  return `${lat}:${lng}:${venueName ?? ""}:${destination}`;
}

export function currentLastTrainState(
  state: LastTrainCardState,
  requestKey: string,
): LastTrainCardState {
  if (state.status !== "loading" && state.requestKey !== requestKey) {
    return { status: "loading" };
  }
  return state;
}

// The API always 200s (even on TfL failure) with either a result or an { error }
// shape; treat anything without a station as "empty" so the card shows the
// friendly note rather than a half-populated panel.
function toState(
  data: Partial<LastTrainResult> & { error?: string },
  requestKey: string,
): LastTrainCardState {
  if (data.station && Array.isArray(data.trains)) {
    return { status: "ready", requestKey, data: data as LastTrainResult };
  }
  return { status: "empty", requestKey };
}

// Pub-voice copy for each decision state (user story 21) — this is the whole
// point: it should read like PUBMAXXING, not a transit dashboard.
const DECISION_COPY: Record<LastPintDecisionKind, string> = {
  order_one_more: "Order one more",
  half_pint_only: "Half pint only",
  settle_up_now: "Settle up now",
  train_risk: "Train risk tonight",
  live_data_unavailable: "Can't check TfL right now",
};

// A colour cue per state (brass/warm for relaxed, ink for urgent) using the
// same CSS custom properties the rest of the map panel reads from.
const DECISION_COLOUR: Record<LastPintDecisionKind, string> = {
  order_one_more: "var(--accent-good, #2f7a3d)",
  half_pint_only: "var(--accent-brass, #9b7a2a)",
  settle_up_now: "var(--accent-warn, #b5651d)",
  train_risk: "var(--accent-risk, #b3261e)",
  live_data_unavailable: "var(--ink-soft, #6b726a)",
};

export function provenanceCopyForDepartures(
  departures: LastTrainResult["departures"] | undefined,
): string {
  const hasLiveDepartures = (departures ?? []).some((d) => d.live);
  return hasLiveDepartures
    ? "Live departures from TfL; last train uses the timetable."
    : "Scheduled times from TfL - not a live feed.";
}

function formatLeaveBy(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

function readSessionDestination(): string {
  if (typeof window === "undefined") return "";
  return readLastTrainDestination(window.sessionStorage);
}

export default function LastTrainCard({
  lat,
  lng,
  venueName,
  onSelectVenue,
  onDecision,
}: LastTrainCardProps) {
  const destinationInputId = useId();
  const [destination, setDestination] = useState(readSessionDestination);
  const [destinationDraft, setDestinationDraft] = useState("");
  const [editingDestination, setEditingDestination] = useState(false);
  const [state, setState] = useState<LastTrainCardState>({ status: "loading" });
  const requestKey = lastTrainRequestKey({ lat, lng, venueName, destination });
  const displayState = currentLastTrainState(state, requestKey);

  function saveDestination(raw: string) {
    const next =
      typeof window === "undefined"
        ? raw.trim()
        : writeLastTrainDestination(raw, window.sessionStorage);
    setDestination(next);
    setDestinationDraft(next);
    setEditingDestination(false);
  }

  function clearDestination() {
    saveDestination("");
  }

  useEffect(() => {
    const controller = new AbortController();
    // React 19: never setState synchronously in the effect body. The initial
    // state is already "loading"; when lat/lng/destination change we let the
    // resolving fetch move us straight to the fresh ready/empty state below.
    fetch(lastTrainFetchUrl(lat, lng, destination), { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: Partial<LastTrainResult> & { error?: string }) => {
        setState(toState(data, requestKey));
      })
      .catch((err: unknown) => {
        // Abort on unmount is expected — not an error surface. Anything else falls
        // through to the friendly empty/error state.
        if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
          return;
        }
        setState({ status: "empty", requestKey });
      });
    return () => controller.abort();
  }, [lat, lng, venueName, destination, requestKey]);

  const decision = displayState.status === "ready" ? displayState.data.decision : undefined;

  // Publish the resolved decision up to the orchestrator (if it asked). This is
  // a parent callback, not local setState, so it's allowed in an effect — and it
  // must run in an effect so it fires after render/commit, never mid-render. It
  // re-runs whenever the decision changes (venue switch, refetch) or clears to
  // null while loading / on TfL failure, so the parent's badges stay in sync
  // with what THIS card actually knows.
  useEffect(() => {
    onDecision?.(decision ?? null);
  }, [decision, onDecision]);

  const leaveBy = decision ? formatLeaveBy(decision.leaveByIso) : null;
  const destinationLabel =
    decision?.destinationLabel?.trim() || destination.trim() || null;
  // Provenance honesty (H5): the Last Pint decision is timetable-based even when
  // next departures are live. Scope the live claim to departures only.
  const provenance =
    displayState.status === "ready"
      ? provenanceCopyForDepartures(displayState.data.departures)
      : null;

  return (
    <section aria-label="Last Pint" style={styles.card}>
      <div style={styles.header}>
        <span style={styles.eyebrow}>Last Pint</span>
        {displayState.status === "ready" ? (
          <span style={styles.station}>
            {displayState.data.station.name}
            {displayState.data.station.distanceM > 0 ? (
              <span style={styles.distance}> · ~{displayState.data.station.distanceM} m away</span>
            ) : null}
          </span>
        ) : null}
      </div>

      <div style={styles.destinationBlock}>
        {destinationLabel && !editingDestination ? (
          <p style={styles.destinationSet}>
            Heading to <strong>{destinationLabel}</strong>
            <button
              type="button"
              style={styles.destinationAction}
              onClick={() => {
                setDestinationDraft(destinationLabel);
                setEditingDestination(true);
              }}
            >
              Change
            </button>
            <button type="button" style={styles.destinationAction} onClick={clearDestination}>
              Clear
            </button>
          </p>
        ) : (
          <form
            style={styles.destinationForm}
            onSubmit={(event) => {
              event.preventDefault();
              saveDestination(destinationDraft);
            }}
          >
            <label style={styles.destinationLabel} htmlFor={destinationInputId}>
              {destinationLabel ? "Update destination" : "Where are you heading?"}
            </label>
            <div style={styles.destinationRow}>
              <input
                id={destinationInputId}
                type="text"
                name="destination"
                autoComplete="off"
                enterKeyHint="done"
                placeholder="Station, postcode, or area"
                value={destinationDraft}
                onChange={(event) => setDestinationDraft(event.target.value)}
                style={styles.destinationInput}
              />
              <button type="submit" style={styles.destinationSubmit}>
                {destinationLabel ? "Update" : "Set"}
              </button>
              {destinationLabel ? (
                <button
                  type="button"
                  style={styles.destinationCancel}
                  onClick={() => {
                    setDestinationDraft(destinationLabel);
                    setEditingDestination(false);
                  }}
                >
                  Cancel
                </button>
              ) : null}
            </div>
            <p style={styles.destinationHint}>Session only — never saved to your profile.</p>
          </form>
        )}
      </div>

      {displayState.status === "loading" ? (
        <p style={styles.note}>Checking trains from near {venueName ?? "here"}…</p>
      ) : null}

      {displayState.status === "empty" ? (
        <p style={styles.note}>Couldn&rsquo;t reach TfL just now — check before you head out.</p>
      ) : null}

      {displayState.status === "ready" &&
      displayState.data.staticFallback &&
      (!displayState.data.trains || displayState.data.trains.length === 0) ? (
        <p style={styles.note}>
          Station from our map — live train times unavailable until TfL responds again.
        </p>
      ) : null}

      {decision ? (
        <div style={styles.decision}>
          <p style={{ ...styles.decisionLine, color: DECISION_COLOUR[decision.decision] }}>
            {DECISION_COPY[decision.decision]}
          </p>
          {leaveBy && decision.decision !== "live_data_unavailable" ? (
            <p style={styles.leaveBy}>Leave by {leaveBy} for the last train.</p>
          ) : null}
          {decision.disruptionSummary ? (
            <p style={styles.disruption}>{decision.disruptionSummary}</p>
          ) : null}
        </div>
      ) : null}

      {displayState.status === "ready" &&
      displayState.data.departures &&
      displayState.data.departures.length > 0 ? (
        <ul style={styles.list}>
          {displayState.data.departures.map((line) => (
            <li key={line.lineId} style={styles.row}>
              <span aria-hidden="true" style={{ ...styles.dot, background: line.colour }} />
              <span style={styles.lineName}>{line.lineName}</span>
              <span style={styles.times}>
                {line.times.join(" · ")}
                {!line.live ? <span style={styles.timetableTag}> (timetable)</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {displayState.status === "ready" && displayState.data.trains.length > 0 ? (
        <ul style={styles.list}>
          {displayState.data.trains.map((train) => (
            <li key={train.lineId} style={styles.row}>
              <span aria-hidden="true" style={{ ...styles.dot, background: train.colour }} />
              <span style={styles.lineName}>Last {train.lineName} line</span>
              <span style={styles.clock}>
                {train.clock}
                {train.pastMidnight ? <span style={styles.tomorrow}> (tomorrow)</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {displayState.status === "ready" &&
      displayState.data.nearestPubs &&
      displayState.data.nearestPubs.length > 0 ? (
        <div style={styles.pubsBlock}>
          <span style={styles.eyebrow}>One more by the platform</span>
          <ul style={styles.pubList}>
            {displayState.data.nearestPubs.map((pub) =>
              onSelectVenue ? (
                <li key={pub.id}>
                  <button
                    type="button"
                    style={styles.pubButton}
                    onClick={() => onSelectVenue(pub.id)}
                  >
                    <span style={styles.pubName}>{pub.name}</span>
                    {typeof pub.price === "number" ? (
                      <span style={styles.pubPrice}>£{pub.price.toFixed(2)}</span>
                    ) : null}
                  </button>
                </li>
              ) : (
                <li key={pub.id} style={styles.pubPlain}>
                  <span style={styles.pubName}>{pub.name}</span>
                  {typeof pub.price === "number" ? (
                    <span style={styles.pubPrice}>£{pub.price.toFixed(2)}</span>
                  ) : null}
                </li>
              ),
            )}
          </ul>
        </div>
      ) : null}

      {displayState.status === "ready" ? (
        <p style={styles.provenance}>{provenance}</p>
      ) : null}
    </section>
  );
}

// Inline styles keep this self-contained (the task owns no CSS file); they lean on
// the app's brass/ink/paper CSS variables so the card matches the other map panels.
const styles: Record<string, React.CSSProperties> = {
  card: {
    borderRadius: "var(--radius-sm, 8px)",
    border: "1px solid var(--line, #d9d4c7)",
    background: "var(--panel-raised, #fbf9f2)",
    color: "var(--ink, #2a2a26)",
    padding: "12px 14px",
    fontSize: 13,
    lineHeight: 1.4,
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    marginBottom: 8,
  },
  eyebrow: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--ink-soft, #6b726a)",
  },
  station: {
    fontWeight: 600,
  },
  distance: {
    fontWeight: 400,
    color: "var(--ink-soft, #6b726a)",
  },
  note: {
    margin: 0,
    color: "var(--ink-soft, #6b726a)",
  },
  decision: {
    margin: "4px 0 10px",
  },
  decisionLine: {
    margin: 0,
    fontSize: 16,
    fontWeight: 700,
  },
  leaveBy: {
    margin: "2px 0 0",
    color: "var(--ink-soft, #6b726a)",
  },
  disruption: {
    margin: "4px 0 0",
    color: "var(--accent-risk, #b3261e)",
    fontSize: 12,
  },
  list: {
    listStyle: "none",
    margin: "0 0 10px",
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    flexShrink: 0,
    boxShadow: "0 0 0 1px rgba(0,0,0,0.12)",
  },
  lineName: {
    flex: 1,
    minWidth: 0,
  },
  times: {
    fontVariantNumeric: "tabular-nums",
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  timetableTag: {
    fontWeight: 400,
    color: "var(--ink-soft, #6b726a)",
  },
  clock: {
    fontVariantNumeric: "tabular-nums",
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  tomorrow: {
    fontWeight: 400,
    color: "var(--ink-soft, #6b726a)",
  },
  pubsBlock: {
    marginTop: 4,
    paddingTop: 8,
    borderTop: "1px solid var(--line, #d9d4c7)",
  },
  pubList: {
    listStyle: "none",
    margin: "6px 0 0",
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  pubPlain: {
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    padding: "2px 0",
  },
  pubButton: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "4px 0",
    background: "none",
    border: "none",
    borderBottom: "1px dashed var(--line, #d9d4c7)",
    color: "var(--ink, #2a2a26)",
    font: "inherit",
    textAlign: "left",
    cursor: "pointer",
  },
  pubName: {
    flex: 1,
    minWidth: 0,
  },
  pubPrice: {
    fontVariantNumeric: "tabular-nums",
    fontWeight: 600,
    whiteSpace: "nowrap",
    color: "var(--ink-soft, #6b726a)",
  },
  provenance: {
    margin: "8px 0 0",
    fontSize: 11,
    color: "var(--ink-soft, #6b726a)",
  },
  destinationBlock: {
    margin: "0 0 10px",
    paddingBottom: 8,
    borderBottom: "1px solid var(--line, #d9d4c7)",
  },
  destinationSet: {
    margin: 0,
    fontSize: 12,
    color: "var(--ink-soft, #6b726a)",
  },
  destinationAction: {
    marginLeft: 8,
    padding: 0,
    border: "none",
    background: "none",
    color: "var(--accent-brass, #9b7a2a)",
    font: "inherit",
    fontSize: 12,
    cursor: "pointer",
    textDecoration: "underline",
  },
  destinationForm: {
    margin: 0,
  },
  destinationLabel: {
    display: "block",
    marginBottom: 4,
    fontSize: 11,
    fontWeight: 600,
    color: "var(--ink-soft, #6b726a)",
  },
  destinationRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    alignItems: "center",
  },
  destinationInput: {
    flex: "1 1 140px",
    minWidth: 0,
    padding: "6px 8px",
    borderRadius: "var(--radius-sm, 6px)",
    border: "1px solid var(--line, #d9d4c7)",
    background: "var(--paper, #fff)",
    color: "var(--ink, #2a2a26)",
    font: "inherit",
    fontSize: 13,
  },
  destinationSubmit: {
    padding: "6px 10px",
    borderRadius: "var(--radius-sm, 6px)",
    border: "1px solid var(--line, #d9d4c7)",
    background: "var(--accent-brass, #9b7a2a)",
    color: "var(--paper, #fff)",
    font: "inherit",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  destinationCancel: {
    padding: "6px 8px",
    border: "none",
    background: "none",
    color: "var(--ink-soft, #6b726a)",
    font: "inherit",
    fontSize: 12,
    cursor: "pointer",
    textDecoration: "underline",
  },
  destinationHint: {
    margin: "4px 0 0",
    fontSize: 10,
    color: "var(--ink-soft, #6b726a)",
  },
};
