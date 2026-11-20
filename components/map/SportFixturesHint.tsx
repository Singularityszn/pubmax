"use client";

import { useEffect, useState } from "react";
import { formatWhatsOnTime } from "@/lib/whatsOnBadges";
import { sportFixtureSource } from "@/lib/sport/fixtureSource";
import { filterNotPast, filterTonight, parseWhatsOnRows, type WhatsOnRow } from "@/lib/whatsOn";
import { useLiveClock } from "@/lib/useLiveClock";

export default function SportFixturesHint() {
  const [rows, setRows] = useState<WhatsOnRow[]>([]);
  const now = useLiveClock(60_000);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/whats-on?kind=sport&window=tonight&limit=100", { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((data: unknown) => {
        if (controller.signal.aborted) return;
        setRows(parseWhatsOnRows(data));
      })
      .catch(() => { if (!controller.signal.aborted) setRows([]); });
    return () => controller.abort();
  }, []);
  const liveRows = now ? filterTonight(filterNotPast(rows, now.getTime()), now.getTime()) : [];
  const listedFixtures = liveRows.flatMap((row) => {
    const source = row.kind === "sport" ? sportFixtureSource(row.id) : null;
    if (!source) return [];
    const time = row.startsAt ? formatWhatsOnTime(row.startsAt) : null;
    return [{ title: `${row.title}${time ? ` · ${time}` : ""}`, source }];
  });
  const fixtures = [...new Map(listedFixtures.map((fixture) => [fixture.title, fixture])).values()].slice(0, 3);
  if (fixtures.length === 0) return null;
  return <div><strong>Fixtures tonight</strong><ul>{fixtures.map((fixture) => <li key={fixture.title}>{fixture.title} · <a href={fixture.source.url}>{fixture.source.label}</a></li>)}</ul><p>These pubs show live sport. Check with the pub that your match is on.</p></div>;
}
