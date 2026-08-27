"use client";

import { useEffect, useState } from "react";

import {
  EDITORIAL_DEGRADED_EMPTY_LINE,
  EDITORIAL_DEGRADED_LINE,
  EDITORIAL_EMPTY_LINE,
  EDITORIAL_RAIL_TITLE,
  editorialOglMarkForSource,
  editorialThisWeekItems,
  editorialViaChip,
  type EditorialSnapshot,
} from "@/lib/editorial";
import { loadEditorialSnapshot } from "@/lib/editorialLoader";

import "./editorialRail.css";

export function EditorialRailView({
  snapshot,
  now,
}: {
  snapshot: EditorialSnapshot;
  now?: number;
}) {
  const items = editorialThisWeekItems(snapshot, now);
  const empty = items.length === 0;
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
      {statusLine ? <p className="editorialRailStatus">{statusLine}</p> : null}
      {items.length > 0 ? (
        <ul className="editorialRailList">
          {items.map((item) => {
            const ogl = editorialOglMarkForSource(item.source_id);
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
                  {ogl ? <span className="editorialRailOgl">{ogl}</span> : null}
                </p>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

export default function EditorialRail() {
  const [snapshot, setSnapshot] = useState<EditorialSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadEditorialSnapshot().then((result) => {
      if (!cancelled) setSnapshot(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

  return <EditorialRailView snapshot={snapshot} />;
}
