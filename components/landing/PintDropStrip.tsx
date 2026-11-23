"use client";

import { useEffect, useMemo, useState } from "react";
import { priceBand, priceBandAreaForVenue } from "@/lib/priceBand";
import { HandCoins } from "lucide-react";

import PriceBadge from "@/components/PriceBadge";
import { formatGbp } from "@/lib/formatGbp";
import { isComparablePintServing } from "@/lib/comparablePint.mjs";
import { drinkMeasureName, statedDrinkMeasure, type DrinkMeasure } from "@/lib/drinkMeasure";
import { cleanPriceEvidence, isUncheckedPrice, type PriceEvidence } from "@/lib/pintDropReceipt";
import { uncheckedPriceLine } from "@/lib/venuePriceLane";
import { useNewSinceLastLook } from "@/lib/seenSinceLastLook";
import NewSinceMarker from "@/components/seen/NewSinceMarker";
import SampleSkeleton from "@/components/ui/sample-skeleton";
import "./pintDropStrip.css";

// Fetches the PUBLIC
// GET /api/pint-drops (no venueId → all visible drops), takes the newest few,
// and renders a horizontal scrollable rail of cards.
//
// The strip renders on the server, so its frame is in the first paint. The
// wait is the real card with sample values, and an empty or failed feed keeps
// the same frame with one line saying why. Nothing below moves when the feed
// answers.

// Local shape — only the public fields we read. Kept in this file so the
// component consumes the public API without importing its store.
type PublicDrop = {
  id: string;
  handle: string;
  priceGbp: number | null;
  priceEvidence?: PriceEvidence;
  drink: string;
  measure: DrinkMeasure | null;
  measureLabel?: string;
  passedDownNote: string;
  era?: string;
  provenance: "sourced" | "contributor" | "anecdote" | "demo";
  venueId: string;
  createdAt: string;
};

type Status = "loading" | "ready" | "empty" | "failed";

const MAX_CARDS = 8;
const NOTE_LIMIT = 90;
const SAMPLE_CARDS = 4;

// The wait's card. It is never read (components/ui/sample-skeleton.tsx), so it
// names no person, prints no price and dates itself the same on the server and
// in the browser.
const SAMPLE_DROP: PublicDrop = {
  id: "sample",
  handle: "a drinker",
  priceGbp: null,
  drink: "Lager",
  measure: "pint",
  passedDownNote: "A line about the pub, as long as a short story on a card.",
  provenance: "contributor",
  venueId: "",
  createdAt: "2026-01-01T00:00:00Z",
};

const QUIET_LINE: Record<"empty" | "failed", string> = {
  empty: "No recent prices with a story yet. Every listed price is still on the map.",
  failed: "Recent prices didn't load. Every listed price is still on the map.",
};

// Human labels for the provenance chip; anything unexpected renders nothing.
// Seeded content always reads "Demo".
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
      drink: typeof d.drink === "string" ? d.drink : "",
      measure: statedDrinkMeasure(d.measure),
      measureLabel: typeof d.measureLabel === "string" ? d.measureLabel : undefined,
      priceEvidence: cleanPriceEvidence(d.priceEvidence),
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

/**
 * What one card prints. The rail, the wait and the quiet frame all draw it. A
 * sample card holds no current price, so its badge is the neutral plaque.
 */
function DropCardBody({ drop: d, isNew, sample = false }: { drop: PublicDrop; isNew: boolean; sample?: boolean }) {
  return (
    <>
      <div className="dropStripTop">
        <span className="dropStripLead">
          <span className="dropStripWho">{d.handle}</span>
          {isNew ? <NewSinceMarker /> : null}
        </span>
        <PriceBadge
          variant={sample ? "neutral" : "current"}
          className="dropStripPrice"
          band={!isUncheckedPrice(d) && d.measure === "pint" && isComparablePintServing({ measure: d.measure, cheapestPint: d.drink })
            ? priceBand(d.priceGbp, priceBandAreaForVenue(d.venueId))
            : null}
        >
          {formatPrice(d.priceGbp)}
        </PriceBadge>
      </div>
      <p className="dropStripNote dropStripFact">
        {d.drink ? `${d.drink} · ` : ""}
        {d.measure ? drinkMeasureName(d.measure, d.measureLabel) : "Measure unknown"}
      </p>
      <p className="dropStripNote dropStripStory">{excerpt(d.passedDownNote)}</p>
      <p className="dropStripNote dropStripLogged">{d.priceGbp !== null && isUncheckedPrice(d) ? uncheckedPriceLine(d.handle) : `Logged by ${d.handle}`} · {Number.isFinite(Date.parse(d.createdAt)) ? `logged ${d.createdAt.slice(0, 10)}` : "date unknown"}</p>
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
    </>
  );
}

export default function PintDropStrip() {
  const [status, setStatus] = useState<Status>("loading");
  const [drops, setDrops] = useState<PublicDrop[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    // Cap how long the wait can sit mid-landing if the feed hangs. After this
    // the strip says the prices did not load. A late answer still lands.
    const hangTimer = window.setTimeout(() => {
      setStatus((current) => (current === "loading" ? "failed" : current));
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
        // Aborts are expected on unmount, so stay quiet. Any other failure
        // keeps the frame and says the prices did not load.
        if (err instanceof DOMException && err.name === "AbortError") return;
        setStatus("failed");
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

  return (
    <div className="dropStrip" data-state={status} aria-labelledby="dropStrip-title">
      <div className="dropStripHead">
        <p className="eyebrow" id="dropStrip-title">
          <HandCoins size={16} aria-hidden="true" />
          Recent prices
        </p>
      </div>

      {status === "ready" ? (
        <DropRail drops={drops} newSinceLastLook={newSinceLastLook} />
      ) : status === "loading" ? (
        <SampleSkeleton label="Loading recent prices" className="dropStripRail">
          {Array.from({ length: SAMPLE_CARDS }, (_, index) => (
            <div className="dropStripCard" key={index}>
              <DropCardBody drop={SAMPLE_DROP} isNew={false} sample />
            </div>
          ))}
        </SampleSkeleton>
      ) : (
        <div className="dropStripRail dropStripRailQuiet">
          <div className="dropStripCard dropStripQuiet">
            <div className="dropStripQuietSizer" aria-hidden="true" inert>
              <DropCardBody drop={SAMPLE_DROP} isNew={false} sample />
            </div>
            <p className="dropStripQuietLine">{QUIET_LINE[status]}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function DropRail({ drops, newSinceLastLook }: { drops: PublicDrop[]; newSinceLastLook: boolean[] }) {
  // The rail scrolls sideways and its cards hold no control of their own, so
  // without a tab stop of its own every drop past the fold was unreachable by
  // keyboard (axe scrollable-region-focusable). Focused, it takes the
  // browser's native arrow-key scrolling; the list keeps its own role, and the
  // label says what the arrows will move.
  return (
    <ul className="dropStripRail" aria-label="Recent prices from drinkers" tabIndex={0}>
      {drops.map((d, index) => (
        <li className="dropStripCard" key={d.id}>
          <DropCardBody drop={d} isNew={newSinceLastLook[index] ?? false} />
        </li>
      ))}
    </ul>
  );
}
