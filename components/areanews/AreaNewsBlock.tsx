"use client";

// The map's "New round here" surface. A client leaf that fetches the fresh-facts
// for the active area from /api/area-news and renders them through AreaNewsList.
// It carries the area it describes in state so a stale block never shows against
// a newly selected area, and it renders NOTHING until (and unless) real facts
// arrive — a quiet area stays quiet, an error is simply an absent block.

import { useEffect, useState } from "react";

import type { AreaNewsEntry } from "@/lib/areaNews";
import AreaNewsList from "./AreaNewsList";

type BlockState = { area: string; entries: AreaNewsEntry[] };

export default function AreaNewsBlock({
  area,
  areaLabel,
  headingId,
}: {
  /** Area slug to look up (a Night Area slug, or a borough slug). */
  area: string | null;
  /** Human-readable label for the heading. */
  areaLabel: string;
  headingId?: string;
}): React.JSX.Element | null {
  const [state, setState] = useState<BlockState | null>(null);

  useEffect(() => {
    if (!area) return;
    const controller = new AbortController();
    fetch(`/api/area-news?area=${encodeURIComponent(area)}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { entries?: AreaNewsEntry[] } | null) => {
        const entries = Array.isArray(body?.entries) ? body.entries : [];
        setState({ area, entries });
      })
      .catch(() => {
        // Fail silent: a missing block is simply absent, never an error.
      });
    return () => controller.abort();
  }, [area]);

  if (!area || !state || state.area !== area || state.entries.length === 0) return null;

  return (
    <AreaNewsList
      areaLabel={areaLabel}
      entries={state.entries}
      headingId={headingId ?? "mapAreaNewsHeading"}
    />
  );
}
