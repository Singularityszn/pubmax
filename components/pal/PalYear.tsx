"use client";

import { useEffect, useState } from "react";

import { useViewerHandle } from "@/components/auth/useViewerHandle";
import PalPrint from "@/components/pal/PalPrint";
import PalYearShare from "@/components/pal/PalYearShare";
import { readProgress } from "@/lib/crawlCompletion";
import { getAccessToken } from "@/lib/authClient";
import { readNightsKept } from "@/lib/nightsKept";
import { londonDayKey } from "@/lib/pintContributions";
import { palYearFacts, palYearLines, type PalYearFacts } from "@/lib/palYear";
import { discardBody } from "@/lib/responseBody";
import { safeLocalStorage } from "@/lib/safeStorage";
import { isYearInPintsSeason } from "@/lib/yearInPints";
import "./palYear.css";

// "Your year so far" on /pal: the person's own Pal reads their year back to
// them, one fact a line (lib/palYear.ts). It is free forever and never a
// score. The nights and crawls are read from this device; the prices mapped
// come from the person's own public stats; at most two pub names are looked
// up so a line can name a pub, and a name that does not arrive is left out.
// In December it is read as the Year in Pints. "Share my year" under it
// (PalYearShare.tsx) sends only the lines the person ticks.

async function venueName(venueId: string, signal: AbortSignal): Promise<string | null> {
  try {
    const response = await fetch(`/api/venue/${encodeURIComponent(venueId)}`, { signal });
    if (!response.ok) {
      discardBody(response);
      return null;
    }
    const body = (await response.json()) as { venue?: { name?: unknown } };
    return typeof body.venue?.name === "string" && body.venue.name.trim() ? body.venue.name.trim() : null;
  } catch {
    return null;
  }
}

async function contributions(handle: string, year: number, signal: AbortSignal): Promise<{ pricesMapped: number; boroughs: number } | null> {
  try {
    const token = await getAccessToken();
    const response = await fetch(`/api/pint-drops/stats?handle=${encodeURIComponent(handle)}&year=${year}`, {
      signal,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      discardBody(response);
      return null;
    }
    const body = (await response.json()) as { stats?: { pintsMapped?: unknown; byBorough?: unknown } };
    const priced = typeof body.stats?.pintsMapped === "number" ? body.stats.pintsMapped : 0;
    const boroughs = Array.isArray(body.stats?.byBorough) ? body.stats.byBorough.length : 0;
    return { pricesMapped: priced, boroughs };
  } catch {
    return null;
  }
}

export default function PalYear({ palName, print }: { palName: string; print: readonly boolean[] }) {
  const handle = useViewerHandle();
  const [facts, setFacts] = useState<PalYearFacts | null>(null);
  const [today, setToday] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    const controller = new AbortController();
    const storage = safeLocalStorage();
    const day = londonDayKey(new Date());
    const year = Number(day.slice(0, 4));
    const nightsKeptDays = readNightsKept(storage).days;
    const crawls = Object.values(readProgress(storage).crawls);
    void (async () => {
      const mapped = handle ? await contributions(handle, year, controller.signal) : null;
      if (controller.signal.aborted) return;
      const next = palYearFacts({ year, nightsKeptDays, crawls, contributions: mapped });
      setFacts(next);
      setToday(day);
      const ids = [next.favourite?.venueId, next.firstNight?.firstStopVenueId].filter((id): id is string => Boolean(id));
      const found: Record<string, string> = {};
      for (const id of new Set(ids)) {
        const name = await venueName(id, controller.signal);
        if (controller.signal.aborted) return;
        if (name) found[id] = name;
      }
      setNames(found);
    })();
    return () => controller.abort();
  }, [handle]);

  if (!facts) return null;
  const lines = palYearLines(facts, names);
  return (
    <section className="palYear" aria-labelledby="pal-year-title" data-testid="pal-year">
      <div className="palYearHead">
        <span className="palYearStamp" aria-hidden="true">
          <PalPrint print={print} />
        </span>
        <div>
          <p className="palEyebrow">{facts.year}</p>
          <h2 id="pal-year-title">{isYearInPintsSeason(today) ? "Your Year in Pints" : "Your year so far"}</h2>
        </div>
      </div>
      {lines.length > 0 ? (
        <ol className="palYearLines">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      ) : (
        <p className="palYearEmpty">Our year starts with your first night out. {palName} will keep it here.</p>
      )}
      <p className="palYearNote">Read from this device and your own mapped prices. Only you see it until you share it.</p>
      <PalYearShare facts={facts} names={names} today={today} />
    </section>
  );
}
