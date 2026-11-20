"use client";

import { useEffect, useState } from "react";
import { formatWhatsOnTime } from "@/lib/whatsOnBadges";

export default function SportFixturesHint({ active }: { active: boolean }) {
  const [fixtures, setFixtures] = useState<string[]>([]);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    fetch("/api/whats-on?kind=sport&window=tonight&limit=100", { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((data: { rows?: Array<{ id?: unknown; title?: unknown; startsAt?: unknown }> } | null) => {
        if (controller.signal.aborted) return;
        const titles = (data?.rows ?? []).flatMap((row) => {
          if (typeof row.id !== "string" || !row.id.startsWith("sport-fixture-of-") || typeof row.title !== "string") return [];
          const time = typeof row.startsAt === "string" ? formatWhatsOnTime(row.startsAt) : null;
          return [`${row.title}${time ? ` · ${time}` : ""}`];
        });
        setFixtures([...new Set(titles)].slice(0, 3));
      })
      .catch(() => { if (!controller.signal.aborted) setFixtures([]); });
    return () => controller.abort();
  }, [active]);
  if (!active || fixtures.length === 0) return null;
  return <div><strong>Fixtures tonight</strong><ul>{fixtures.map((fixture) => <li key={fixture}>{fixture}</li>)}</ul><p>These pubs show live sport. Check with the pub that your match is on. Fixtures: <a href="https://github.com/openfootball/football.json">OpenFootball</a>.</p></div>;
}
