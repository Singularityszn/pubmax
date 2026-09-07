"use client";

// "New round here" rail block for wide viewports. Reads the fresh-facts layer
// (/api/area-news, Cycle 15 Lane A). Fail-soft by design: while that API is not
// yet deployed (PR #380) this renders nothing, a failed read prints one line
// about us, and a successful EMPTY read renders nothing, because an empty rail
// is chrome over the pins (the area page's AreaNewsBlock keeps the honest
// empty line, where a reader asked for the news).
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

type AreaNewsResponse = { status?: "ready" | "unavailable"; entries?: AreaNewsEntry[] };

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
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [loadedArea, setLoadedArea] = useState<string | null>(null);

  useEffect(() => {
    if (!area) return;
    const controller = new AbortController();
    fetch(`/api/area-news?area=${encodeURIComponent(area)}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Area news request failed: ${res.status}`);
        return res.json();
      })
      .then((body: AreaNewsResponse | null) => {
        if (controller.signal.aborted) return;
        if (body?.status === "unavailable") {
          setEntries([]);
          setLoadedArea(area);
          setStatus("unavailable");
          return;
        }
        if (!Array.isArray(body?.entries)) throw new Error("Area news response was not valid.");
        setEntries(body.entries.slice(0, 3));
        setLoadedArea(area);
        setStatus("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setEntries([]);
          setLoadedArea(area);
          setStatus("unavailable");
        }
      });
    return () => controller.abort();
  }, [area]);

  if (!area || loadedArea !== area || status === "loading") return null;

  if (status === "unavailable") {
    return (
      <section className="areaNewsRail" aria-label="New round here">
        <h2 className="areaNewsRailTitle">New round here</h2>
        <p className="areaNewsRailEmpty">Area updates are unavailable right now.</p>
      </section>
    );
  }

  // A rail with nothing in it is chrome over the map, not an answer: the
  // desktop first load stood a "New round here / No current updates here."
  // panel over the pins beside five other controls (measured 6 Sep 2026).
  // The honest empty line still prints where a reader ASKED for area news
  // (AreaNewsBlock on the area page); a read we could not run keeps its own
  // line above, because that one is a fact about us.
  if (entries.length === 0) return null;

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
