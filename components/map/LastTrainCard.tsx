"use client";

// "Last drink / last train home" card. Given a venue's coordinates, it fetches the
// nearest Tube/rail station and each serving line's last train tonight, so a
// drinker knows when to head off. Wired into the venue panel by the orchestrator —
// this file does NOT render itself anywhere.
//
// React 19 rules: the fetch fires in an effect but setState only ever runs inside
// the async resolution/catch (never the effect body). AbortController cancels the
// request on unmount. Provenance-honest: a small "Live from TfL." note, and a warm
// fallback when TfL can't be reached (we never show a broken card).

import { useEffect, useState } from "react";

import type { LastTrainResult } from "@/lib/tfl";

type LastTrainCardProps = {
  lat: number;
  lng: number;
  venueName?: string;
};

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: LastTrainResult }
  | { status: "empty" };

// The API always 200s (even on TfL failure) with either a result or an { error }
// shape; treat anything without a station-and-trains as "empty" so the card shows
// the friendly note rather than a half-populated panel.
function toState(data: Partial<LastTrainResult> & { error?: string }): LoadState {
  if (data.station && Array.isArray(data.trains) && data.trains.length > 0) {
    return { status: "ready", data: data as LastTrainResult };
  }
  return { status: "empty" };
}

export default function LastTrainCard({ lat, lng, venueName }: LastTrainCardProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    // React 19: never setState synchronously in the effect body. The initial
    // state is already "loading"; when lat/lng change we let the resolving fetch
    // move us straight to the fresh ready/empty state below.
    fetch(`/api/last-train?lat=${lat}&lng=${lng}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: Partial<LastTrainResult> & { error?: string }) => {
        setState(toState(data));
      })
      .catch((err: unknown) => {
        // Abort on unmount is expected — not an error surface. Anything else falls
        // through to the friendly empty/error state.
        if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
          return;
        }
        setState({ status: "empty" });
      });
    return () => controller.abort();
  }, [lat, lng]);

  return (
    <section aria-label="Getting home" style={styles.card}>
      <div style={styles.header}>
        <span style={styles.eyebrow}>Getting home</span>
        {state.status === "ready" ? (
          <span style={styles.station}>
            {state.data.station.name}
            {state.data.station.distanceM > 0 ? (
              <span style={styles.distance}> · ~{state.data.station.distanceM} m away</span>
            ) : null}
          </span>
        ) : null}
      </div>

      {state.status === "loading" ? (
        <p style={styles.note}>Checking the last trains from near {venueName ?? "here"}…</p>
      ) : null}

      {state.status === "empty" ? (
        <p style={styles.note}>Couldn&rsquo;t reach TfL just now — check before you head out.</p>
      ) : null}

      {state.status === "ready" ? (
        <ul style={styles.list}>
          {state.data.trains.map((train) => (
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

      {state.status === "ready" ? <p style={styles.provenance}>Live from TfL.</p> : null}
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
  list: {
    listStyle: "none",
    margin: 0,
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
  clock: {
    fontVariantNumeric: "tabular-nums",
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  tomorrow: {
    fontWeight: 400,
    color: "var(--ink-soft, #6b726a)",
  },
  provenance: {
    margin: "8px 0 0",
    fontSize: 11,
    color: "var(--ink-soft, #6b726a)",
  },
};
