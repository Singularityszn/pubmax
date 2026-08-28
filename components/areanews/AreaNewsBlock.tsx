"use client";

// The map's "New round here" surface. A client leaf that fetches the fresh-facts
// for the active area from /api/area-news and renders them through AreaNewsList.
// It carries area it describes in state so stale data never shows against newly
// selected area. Empty successful responses render through AreaNewsList.

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
      .then((res) => {
        if (!res.ok) throw new Error(`Area news request failed: ${res.status}`);
        return res.json();
      })
      .then((body: { entries?: AreaNewsEntry[] } | null) => {
        if (!Array.isArray(body?.entries)) throw new Error("Area news response was not valid.");
        const entries = body.entries;
        setState({ area, entries });
      })
      .catch(() => {
        // Fail silent: a missing block is simply absent, never an error.
      });
    return () => controller.abort();
  }, [area]);

  if (!area || !state || state.area !== area) return null;

  return (
    <AreaNewsList
      areaLabel={areaLabel}
      entries={state.entries}
      headingId={headingId ?? "mapAreaNewsHeading"}
    />
  );
}
