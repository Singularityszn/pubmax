"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  EDITORIAL_DEGRADED_EMPTY_LINE,
  EDITORIAL_DEGRADED_LINE,
  EDITORIAL_EMPTY_LINE,
  EDITORIAL_RAIL_TITLE,
  editorialOglAttributionForSource,
  editorialSnapshotIsStale,
  editorialThisWeekItems,
  editorialViaChip,
  type EditorialSnapshot,
} from "@/lib/editorial";
import { loadEditorialSnapshot } from "@/lib/editorialLoader";
import { OUT_MAP_WAY, OUT_RETRY_LABEL } from "@/lib/out/outStatus";
import EmptyState from "@/components/ui/empty-state";

import "./editorialRail.css";

export function EditorialRailView({
  snapshot,
  now,
  onRetry,
}: {
  snapshot: EditorialSnapshot;
  now?: number;
  onRetry: () => void;
}) {
  const [mountedAt] = useState(() => Date.now());
  const resolvedNow = now ?? mountedAt;
  const stale = editorialSnapshotIsStale(snapshot, resolvedNow);
  const items = stale ? [] : editorialThisWeekItems(snapshot, resolvedNow);
  const empty = items.length === 0;

  // A stale snapshot never carries this-week rows (see `stale` above), so
  // stale and empty are the same case here. Printing an apology for a quiet
  // maintenance gap read as the rail's main story; a stale-and-empty rail
  // says nothing instead of a line about US.
  if (stale && empty) return null;

  const statusLine =
    snapshot.status === "degraded"
      ? empty
        ? EDITORIAL_DEGRADED_EMPTY_LINE
        : EDITORIAL_DEGRADED_LINE
      : empty
        ? EDITORIAL_EMPTY_LINE
        : null;

  return (
    <section className="editorialRail" aria-labelledby="editorial-rail-heading">
      <h2 id="editorial-rail-heading" className="editorialRailTitle">
        {EDITORIAL_RAIL_TITLE}
      </h2>
      {statusLine && empty ? (
        // Nothing to read this week is still a night out, and the pubs are
        // always there. A bare sentence under the heading was a dead end.
        <div role={snapshot.status === "degraded" ? "alert" : "status"}>
          <EmptyState
            title={statusLine}
            action={
              snapshot.status === "degraded" ? (
                <button type="button" onClick={onRetry}>
                  {OUT_RETRY_LABEL}
                </button>
              ) : (
                <Link prefetch={false} href={OUT_MAP_WAY.href}>
                  {OUT_MAP_WAY.label}
                </Link>
              )
            }
          />
        </div>
      ) : statusLine ? (
        <p className="editorialRailStatus">{statusLine}</p>
      ) : null}
      {items.length > 0 ? (
        <ul className="editorialRailList">
          {items.map((item) => {
            const ogl = editorialOglAttributionForSource(item.source_id);
            return (
              <li key={item.canonical_url} className="editorialRailItem">
                <a
                  className="editorialRailLink"
                  href={item.canonical_url}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {item.title}
                </a>
                {item.excerpt ? <p className="editorialRailExcerpt">{item.excerpt}</p> : null}
                <p className="editorialRailCredit">
                  <span className="editorialRailChip">{editorialViaChip(item.attribution_label)}</span>
                  {ogl ? (
                    <a
                      className="editorialRailOgl"
                      href={ogl.url}
                      rel="license noopener noreferrer"
                      target="_blank"
                    >
                      {ogl.label}
                    </a>
                  ) : null}
                </p>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

type EditorialLoadTiming = {
  pageLoaded: () => boolean;
  afterPageLoad: (callback: () => void) => () => void;
  nextFrame: (callback: () => void) => () => void;
  nextTask: (callback: () => void) => () => void;
};

const browserEditorialLoadTiming: EditorialLoadTiming = {
  pageLoaded: () => document.readyState === "complete",
  afterPageLoad: (callback) => {
    window.addEventListener("load", callback, { once: true });
    return () => window.removeEventListener("load", callback);
  },
  nextFrame: (callback) => {
    const id = window.requestAnimationFrame(callback);
    return () => window.cancelAnimationFrame(id);
  },
  nextTask: (callback) => {
    const id = window.setTimeout(callback, 0);
    return () => window.clearTimeout(id);
  },
};

/** Keep this secondary rail out of the route's load and first-answer waterfall. */
export function scheduleEditorialLoad(
  start: () => void,
  timing: EditorialLoadTiming = browserEditorialLoadTiming,
): () => void {
  let cancelled = false;
  let cancelFrame: () => void = () => undefined;
  let cancelTask: () => void = () => undefined;
  const queueAfterPaint = () => {
    if (cancelled) return;
    cancelFrame = timing.nextFrame(() => {
      if (cancelled) return;
      cancelTask = timing.nextTask(() => {
        if (!cancelled) start();
      });
    });
  };
  const cancelPageLoad = timing.pageLoaded()
    ? (queueAfterPaint(), () => undefined)
    : timing.afterPageLoad(queueAfterPaint);

  return () => {
    cancelled = true;
    cancelPageLoad();
    cancelFrame();
    cancelTask();
  };
}

export default function EditorialRail() {
  const [snapshot, setSnapshot] = useState<EditorialSnapshot | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void loadEditorialSnapshot().then((result) => {
        if (!cancelled) setSnapshot(result);
      });
    };
    const cancelLoad = loadAttempt === 0 ? scheduleEditorialLoad(load) : () => undefined;
    if (loadAttempt > 0) load();
    return () => {
      cancelled = true;
      cancelLoad();
    };
  }, [loadAttempt]);

  function retry() {
    setSnapshot(null);
    setLoadAttempt((attempt) => attempt + 1);
  }

  if (!snapshot) {
    return (
      <section
        className="editorialRail"
        aria-labelledby="editorial-rail-heading"
        aria-busy="true"
      >
        <h2 id="editorial-rail-heading" className="editorialRailTitle">
          {EDITORIAL_RAIL_TITLE}
        </h2>
        <p className="editorialRailLoading">Loading picks</p>
      </section>
    );
  }

  return <EditorialRailView snapshot={snapshot} onRetry={retry} />;
}
