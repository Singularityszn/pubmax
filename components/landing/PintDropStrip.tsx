"use client";

import { useEffect, useMemo, useState } from "react";
import { priceBand, priceBandAreaForVenue } from "@/lib/priceBand";
import { HandCoins } from "lucide-react";

import PriceBadge from "@/components/PriceBadge";
import { formatGbp } from "@/lib/formatGbp";
import { useNewSinceLastLook } from "@/lib/seenSinceLastLook";
import NewSinceMarker from "@/components/seen/NewSinceMarker";

// Live community Pint Drops strip for the landing page. Fetches the PUBLIC
// GET /api/pint-drops (no venueId → all visible drops), takes the newest few,
// and renders a horizontal scrollable rail of cards.
//
// Failure is silent by design: if the fetch throws, aborts, times out, or
// returns a non-OK / malformed body, we render NOTHING, and so does an empty
// feed. Nothing paints while the fetch is in flight either (UX audit, 16 Oct
// 2026): the strip sits far below the fold, so it can arrive whole when it has
// rows, and a slow connection never meets a band of grey cards. The dynamic
// import in LandingPage paints nothing while the chunk loads too.

// Local shape — only the public fields we read. Kept in this file so the
// component stays inside its ownership boundary (it consumes the API by fetch;
// it does not import from lib).
type PublicDrop = {
  id: string;
  handle: string;
  priceGbp: number | null;
  passedDownNote: string;
  era?: string;
  provenance: "sourced" | "contributor" | "anecdote" | "demo";
  venueId: string;
  createdAt: string;
};

type Status = "loading" | "ready" | "empty" | "hidden";

const MAX_CARDS = 8;
const NOTE_LIMIT = 90;

// Human labels for the provenance chip; anything unexpected renders nothing.
// Kept local (this file deliberately imports nothing from lib) but the words
// mirror lib/provenanceLabels.ts — seeded content always reads "Demo".
const PROVENANCE_LABEL: Record<PublicDrop["provenance"], string> = {
  contributor: "Contributor",
  sourced: "Sourced",
  anecdote: "Anecdote",
  demo: "Demo",
};

function formatPrice(price: number | null): string {
  if (typeof price !== "number" || !Number.isFinite(price)) return "–";
  return formatGbp(price);
}

function excerpt(note: string): string {
  const trimmed = note.trim();
  if (trimmed.length <= NOTE_LIMIT) return trimmed;
  // Cut on a word boundary near the limit so we never split mid-word.
  const slice = trimmed.slice(0, NOTE_LIMIT);
  const lastSpace = slice.lastIndexOf(" ");
  return `${(lastSpace > 40 ? slice.slice(0, lastSpace) : slice).trimEnd()}…`;
}

// Sort newest-first defensively (the API already caps + orders, but we don't
// trust ordering) and keep only well-formed, note-bearing rows.
function pickDrops(raw: unknown): PublicDrop[] {
  if (!raw || typeof raw !== "object") return [];
  const list = (raw as { drops?: unknown }).drops;
  if (!Array.isArray(list)) return [];
  const clean: PublicDrop[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const d = item as Record<string, unknown>;
    const handle = typeof d.handle === "string" ? d.handle : "";
    const note = typeof d.passedDownNote === "string" ? d.passedDownNote : "";
    if (!handle || !note.trim()) continue;
    clean.push({
      id: String(d.id ?? handle + note.slice(0, 12)),
      handle,
      priceGbp:
        typeof d.priceGbp === "number" && Number.isFinite(d.priceGbp)
          ? d.priceGbp
          : null,
      passedDownNote: note,
      era: typeof d.era === "string" ? d.era : undefined,
      provenance:
        d.provenance === "sourced" ||
        d.provenance === "contributor" ||
        d.provenance === "anecdote" ||
        d.provenance === "demo"
          ? d.provenance
          : "anecdote",
      venueId: typeof d.venueId === "string" ? d.venueId : "",
      createdAt: typeof d.createdAt === "string" ? d.createdAt : "",
    });
  }
  return clean
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_CARDS);
}

export default function PintDropStrip() {
  const [status, setStatus] = useState<Status>("loading");
  const [drops, setDrops] = useState<PublicDrop[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    // Cap how long the skeleton rail can sit mid-landing if the feed hangs.
    // After this, treat as empty and fail-soft hide (same end state as no drops).
    const hangTimer = window.setTimeout(() => {
      setStatus((current) => (current === "loading" ? "empty" : current));
    }, 8_000);

    // The fetch runs in the effect but setState is only ever called from the
    // async handlers below (never the synchronous effect body) — this keeps
    // react-hooks/set-state-in-effect happy under React 19.
    fetch("/api/pint-drops", { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((body) => {
        const picked = pickDrops(body);
        setDrops(picked);
        setStatus(picked.length ? "ready" : "empty");
      })
      .catch((err: unknown) => {
        // Aborts are expected on unmount — stay quiet. Any other failure hides
        // the strip entirely so the static fallback carries the section.
        if (err instanceof DOMException && err.name === "AbortError") return;
        setStatus("hidden");
      });

    return () => {
      controller.abort();
      window.clearTimeout(hangTimer);
    };
  }, []);

  // Which drops this device has not been shown before (lib/seenSinceLastLook.ts).
  // A drop is its own row, so each is judged by its own id, and they are
  // remembered only once the strip has painted them.
  const dropIds = useMemo(() => drops.map((d) => [d.id]), [drops]);
  const newSinceLastLook = useNewSinceLastLook("drops", dropIds, status === "ready");

  // Fail-soft (journey audit P1): hidden on fetch failure, hidden when the
  // feed is empty after load, and hidden while it loads, so the section only
  // ever paints with real rows in it.
  if (status !== "ready" || drops.length === 0) return null;

  return (
    <div className="dropStrip" aria-labelledby="dropStrip-title">
      <div className="dropStripHead">
        <p className="eyebrow" id="dropStrip-title">
          <HandCoins size={16} aria-hidden="true" />
          Recent prices
        </p>
      </div>

      {/* The rail scrolls sideways and its cards hold no control of their own,
          so without a tab stop of its own every drop past the fold was
          unreachable by keyboard (axe scrollable-region-focusable). Focused,
          it takes the browser's native arrow-key scrolling; the list keeps its
          own role, and the label says what the arrows will move. */}
      <ul
        className="dropStripRail"
        aria-label="Recent prices from drinkers"
        tabIndex={0}
      >
        {drops.map((d, index) => (
          <li className="dropStripCard" key={d.id}>
            <div className="dropStripTop">
              <span className="dropStripLead">
                <span className="dropStripWho">{d.handle}</span>
                {newSinceLastLook[index] ? <NewSinceMarker /> : null}
              </span>
              <PriceBadge
                variant="current"
                className="dropStripPrice"
                band={priceBand(d.priceGbp, priceBandAreaForVenue(d.venueId))}
              >
                {formatPrice(d.priceGbp)}
              </PriceBadge>
            </div>
            <p className="dropStripNote">{excerpt(d.passedDownNote)}</p>
            <div className="dropStripMeta">
              {d.era ? (
                <span className="dropStripEra">{d.era}</span>
              ) : (
                <span className="dropStripEra dropStripEraMuted">
                  Pint Drop
                </span>
              )}
              <span className={`provChip provChip-${d.provenance}`}>
                {PROVENANCE_LABEL[d.provenance]}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
