"use client";

import { useEffect, useState } from "react";
import { formatWhatsOnTime } from "@/lib/whatsOnBadges";
import { sportFixtureSource } from "@/lib/sport/fixtureSource";

export default function SportFixturesHint() {
  const [fixtures, setFixtures] = useState<Array<{ title: string; source: NonNullable<ReturnType<typeof sportFixtureSource>> }>>([]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/whats-on?kind=sport&window=tonight&limit=100", { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((data: { rows?: Array<{ id?: unknown; title?: unknown; startsAt?: unknown }> } | null) => {
        if (controller.signal.aborted) return;
        const fixtures = (data?.rows ?? []).flatMap((row) => {
          if (typeof row.id !== "string" || typeof row.title !== "string") return [];
          const source = sportFixtureSource(row.id);
          if (!source) return [];
          const time = typeof row.startsAt === "string" ? formatWhatsOnTime(row.startsAt) : null;
          return [{ title: `${row.title}${time ? ` · ${time}` : ""}`, source }];
        });
        setFixtures([...new Map(fixtures.map((fixture) => [fixture.title, fixture])).values()].slice(0, 3));
      })
      .catch(() => { if (!controller.signal.aborted) setFixtures([]); });
    return () => controller.abort();
  }, []);
  if (fixtures.length === 0) return null;
  return <div><strong>Fixtures tonight</strong><ul>{fixtures.map((fixture) => <li key={fixture.title}>{fixture.title} · <a href={fixture.source.url}>{fixture.source.label}</a></li>)}</ul><p>These pubs show live sport. Check with the pub that your match is on.</p></div>;
}
