"use client";

// "New round here" rail block for wide viewports. Reads the fresh-facts layer
// (/api/area-news, Cycle 15 Lane A). Fail-soft by design: while that API is not
// yet deployed (PR #380), or the area has no dated facts, this renders NOTHING.
// Every item is a dated, source-linked fact; no filler, no em dashes.

import { useEffect, useState } from "react";

import "./areaNewsRail.css";

// Minimal response shape (mirrors data/area_news.json entries; the API caps at 3).
type AreaNewsEntry = {
  id: string;
  kind: string;
  title: string;
  detail?: string;
  sourceUrl: string;
  sourceName: string;
  observedAt: string;
};

type AreaNewsResponse = { entries?: AreaNewsEntry[] };

function shortDate(iso: string): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/London",
  });
}

export default function AreaNewsRail({ area }: { area: string | null }) {
  const [entries, setEntries] = useState<AreaNewsEntry[]>([]);

  useEffect(() => {
    if (!area) return;
    const controller = new AbortController();
    fetch(`/api/area-news?area=${encodeURIComponent(area)}`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: AreaNewsResponse | null) => {
        if (controller.signal.aborted) return;
        setEntries(Array.isArray(body?.entries) ? body.entries.slice(0, 3) : []);
      })
      .catch(() => {
        if (!controller.signal.aborted) setEntries([]);
      });
    return () => controller.abort();
  }, [area]);

  if (!area || entries.length === 0) return null;

  return (
    <section className="areaNewsRail" aria-label="New round here">
      <h2 className="areaNewsRailTitle">New round here</h2>
      <ul className="areaNewsRailList">
        {entries.map((entry) => {
          const date = shortDate(entry.observedAt);
          return (
            <li key={entry.id} className="areaNewsRailItem">
              <p className="areaNewsRailItemTitle">{entry.title}</p>
              <p className="areaNewsRailItemMeta">
                <a href={entry.sourceUrl} target="_blank" rel="noreferrer noopener">
                  {entry.sourceName}
                </a>
                {date ? <span> · {date}</span> : null}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
