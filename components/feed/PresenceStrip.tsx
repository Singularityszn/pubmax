"use client";

// "Live tonight" presence strip (PRD §1.5 / §5.1 — the tonight loop). A compact,
// horizontal band at the top of the feed showing who tapped "I'm here" recently:
// "@handle at The Lamb · 12m ago", each pub linking to /map?sel=<venueId>.
//
// Fail-quiet by design: an empty or failed fetch renders NOTHING (never a broken
// band). React 19 rules — fetch fires in an effect, setState only inside the
// async resolution/catch (never the effect body), AbortController cancels on
// unmount.

import Link from "next/link";
import { useEffect, useState } from "react";

type PresenceDTO = {
  handle: string;
  venueId: string;
  venueName: string;
  venueMapUrl: string;
  at: string;
};

// Whole-number "n ago" — the same rounding the feed cards use, off a stable
// timestamp so there's no live ticking / hydration surprise. This strip only
// mounts client-side (after fetch), so a rough label is fine.
function relativeTime(at: string): string {
  const then = Date.parse(at);
  if (!Number.isFinite(then)) return "";
  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

export default function PresenceStrip() {
  const [presence, setPresence] = useState<PresenceDTO[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/presence", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { presence?: PresenceDTO[] }) => {
        setPresence(Array.isArray(data.presence) ? data.presence : []);
      })
      .catch((err: unknown) => {
        // Abort is expected on unmount — not an error surface. Any other failure
        // leaves presence empty, so the strip simply doesn't render.
        if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
          return;
        }
        setPresence([]);
      });
    return () => controller.abort();
  }, []);

  // Empty (or failed) → render nothing. Never a broken/empty band.
  if (presence.length === 0) return null;

  return (
    <section className="presenceStrip" aria-label="People out tonight">
      <span className="presenceStripLabel">
        <span className="presenceDot" aria-hidden="true" />
        Live tonight
      </span>
      <ul className="presenceList">
        {presence.map((p) => {
          const ago = relativeTime(p.at);
          return (
            <li key={`${p.handle}-${p.venueId}`} className="presenceItem">
              <span className="presenceHandle">@{p.handle}</span>
              <span className="presenceAt">at</span>
              <Link href={p.venueMapUrl} className="presenceVenue">
                {p.venueName}
              </Link>
              {ago ? <span className="presenceAgo">· {ago}</span> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
