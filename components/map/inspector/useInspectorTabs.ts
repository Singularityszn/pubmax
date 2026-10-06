import { useCallback, useRef, useState } from "react";

import type { TabKey } from "@/lib/venueInspectorTabs";

type TabDef = { key: TabKey; label: string; shortLabel: string };

export function useInspectorTabs(
  initialTab: TabKey,
  venueId: string,
  TABS: TabDef[],
  onTabSelect?: (key: TabKey) => void,
  resetRequest = 0,
) {
  // Active tab is local state, seeded from the resolved request.
  // Like presence above, the panel isn't remounted between venues, so a stale
  // tab could linger - React's adjust-state-during-render pattern resets it when
  // the venue id, the resolved tab or `resetRequest` changes (mirrors
  // presenceVenueId). `resetRequest` is the getting-home request count: that
  // request resolves to "overview", the same tab a plain open resolves to, so
  // only a new count lands a sheet already open on another tab back on the
  // Overview. An ordinary re-render keeps the reader's tab. NEVER setState in an
  // effect here (react-hooks/set-state-in-effect is an error in this repo).
  const [tab, setTab] = useState<TabKey>(initialTab);
  const tabKey = `${venueId}:${initialTab}:${resetRequest}`;
  const [tabResetKey, setTabResetKey] = useState(tabKey);
  if (tabResetKey !== tabKey) {
    setTabResetKey(tabKey);
    setTab(initialTab);
  }

  // Refs to the tab buttons so arrow keys can move focus as selection moves
  // (roving tabindex / APG tabs pattern).
  const tabRefs = useRef<Record<TabKey, HTMLButtonElement | null>>({
    overview: null,
    photos: null,
    pints: null,
    menu: null,
    story: null,
  });

  const selectTab = useCallback(
    (next: TabKey) => {
      setTab(next);
      onTabSelect?.(next);
      tabRefs.current[next]?.focus();
    },
    [onTabSelect],
  );

  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, current: TabKey) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const index = TABS.findIndex((t) => t.key === current);
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const next = TABS[(index + delta + TABS.length) % TABS.length];
    if (next) selectTab(next.key);
  }

  return { tab, selectTab, onTabKeyDown, tabRefs };
}
