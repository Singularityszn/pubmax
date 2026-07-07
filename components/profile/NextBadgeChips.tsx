"use client";

import { useEffect, useState } from "react";

import {
  nextBadgeProgress,
  normalizeHandle,
  profileStats,
  type BadgeProgress,
  type ProfileDrop,
} from "@/lib/profiles";

import "./nextBadgeChips.css";

// Quest chips (IDEAS B2-lite): forward-looking "next badge" progress for the
// viewer's self-asserted handle. Self-contained on purpose — it resolves the
// handle the same way /activity does (localStorage `pubmax_handle`, read AFTER
// mount so server render and hydration agree), fetches the public drops, and
// computes progress with the pure lib/profiles helpers. Honesty rules:
//  • no handle → renders nothing (no invented identity);
//  • fetch failed → renders nothing (a guess is worse than silence);
//  • every badge earned → renders nothing (no fake quests).
// A `handle` prop skips the localStorage read when the parent already knows it.

const HANDLE_KEY = "pubmax_handle";
const MAX_CHIPS = 2;

export default function NextBadgeChips({ handle }: { handle?: string }): React.JSX.Element | null {
  const [quests, setQuests] = useState<BadgeProgress[]>([]);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      const resolved = normalizeHandle(
        handle ??
          (typeof window === "undefined" ? "" : (window.localStorage.getItem(HANDLE_KEY) ?? "")),
      );
      if (!resolved) return;
      try {
        const res = await fetch("/api/pint-drops", { signal: controller.signal });
        if (!res.ok) return;
        const body: unknown = await res.json();
        const all: ProfileDrop[] =
          body && typeof body === "object" && Array.isArray((body as { drops?: unknown }).drops)
            ? ((body as { drops: ProfileDrop[] }).drops ?? [])
            : [];
        const mine = all.filter((d) => normalizeHandle(d.handle) === resolved);
        if (controller.signal.aborted) return;
        setQuests(nextBadgeProgress(mine, profileStats(mine)));
      } catch {
        // Silence over a guessed quest — aborts and network failures render nothing.
      }
    }

    void load();
    return () => controller.abort();
  }, [handle]);

  if (quests.length === 0) return null;

  return (
    <div className="questChips" aria-label="Next badge progress">
      <span className="questChipsKicker">Next badge</span>
      {quests.slice(0, MAX_CHIPS).map((quest) => (
        <span key={quest.badge.id} className="questChip">
          <span className="questChipCount">
            {quest.current}/{quest.target}
          </span>
          {quest.label}
        </span>
      ))}
    </div>
  );
}
