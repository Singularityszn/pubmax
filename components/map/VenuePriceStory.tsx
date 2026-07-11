"use client";

import { useCallback, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Minus, TrendingUp } from "lucide-react";

import PriceBadge from "@/components/PriceBadge";
import { formatPrice, type Venue } from "@/lib/venues";
import type { Provenance } from "@/lib/curation";
import { PROVENANCE_LABEL } from "@/lib/provenanceLabels";
import {
  computeVenuePriceStory,
  type VenuePriceStamp,
  type VenuePriceStoryDrop,
} from "@/lib/thenVsNow";

import "./venuePriceStory.css";

// The Golden Thread on the venue surface: a pub's own price story — the baseline
// price on record, the freshest community-logged price, the delta between them,
// and (when the community has passed down a dated memory) an inflation line
// "a pint here was £X in YYYY — £Y in today's money". Purely presentational and
// prop-driven: VenueInspector computes nothing; it hands over the venue + its
// drops and this block resolves the whole story via computeVenuePriceStory.
//
// Provenance is NEVER flattened: every figure carries its own badge (sourced /
// contributor / anecdote / demo) so a seeded demo price can never masquerade as
// real community data. When the venue has no price story at all, an honest
// empty state renders instead of an empty frame.

function ProvChip({ provenance }: { provenance: Provenance }) {
  return <span className={`provChip ${provenance}`}>{PROVENANCE_LABEL[provenance]}</span>;
}

function direction(deltaGbp: number): "up" | "down" | "flat" {
  const pennies = Math.round(deltaGbp * 100);
  if (pennies > 0) return "up";
  if (pennies < 0) return "down";
  return "flat";
}

// The two price values are also drawn as proportional bars — the longer bar is
// the dearer pint, so the movement reads at a glance before any number is parsed.
function StoryBars({ baseline, now }: { baseline: VenuePriceStamp; now: VenuePriceStamp }) {
  const max = Math.max(baseline.gbp, now.gbp, 0.01);
  const thenPct = Math.max(6, Math.round((baseline.gbp / max) * 100));
  const nowPct = Math.max(6, Math.round((now.gbp / max) * 100));
  return (
    <div className="vpsBars" aria-hidden="true">
      <div className="vpsBarRow">
        <span className="vpsBarLabel">Baseline</span>
        <span className="vpsBarTrack">
          <span className="vpsBarFill vpsBarFillThen" style={{ width: `${thenPct}%` }} />
        </span>
        <span className="vpsBarValue">{formatPrice(baseline.gbp)}</span>
      </div>
      <div className="vpsBarRow">
        <span className="vpsBarLabel">Now</span>
        <span className="vpsBarTrack">
          <span className="vpsBarFill vpsBarFillNow" style={{ width: `${nowPct}%` }} />
        </span>
        <span className="vpsBarValue">{formatPrice(now.gbp)}</span>
      </div>
    </div>
  );
}

// A hand-drawn check — an inline SVG (not a lucide glyph) so the confirmed state
// can stroke-draw the tick on: the single path is animated via stroke-dashoffset
// in venuePriceStory.css, gated behind prefers-reduced-motion.
function ConfirmTick() {
  return (
    <svg
      className="vpsConfirmTick"
      viewBox="0 0 20 20"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path className="vpsConfirmTickPath" d="M4 10.6 L8.4 15 L16 5.4" />
    </svg>
  );
}

// One-tap "still accurate?" micro-contribution. Tapping vouches the displayed
// price is still right and flips to an optimistic confirmed state instantly (a
// satisfying scale-in + tick draw); the POST to /api/price-confirm is fail-soft,
// so the confirmed state stands even if the backend is unavailable. This is a
// lightweight community signal, never a new price — the store only ever counts
// distinct confirmers of an already-shown figure. Keyed by venue+price by the
// caller so it resets cleanly when the inspected pub changes.
function PriceConfirmChip({
  venueId,
  priceGbp,
  priceLabel,
}: {
  venueId: string;
  priceGbp: number;
  priceLabel: string;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [confirms, setConfirms] = useState<number | null>(null);

  const confirm = useCallback(async () => {
    if (confirmed) return; // a vouch is one-way; re-taps are inert (idempotent).
    // Optimistic: flip to confirmed before the network round-trip so the tap
    // feels instant. The real distinct-confirmer count backfills when it lands.
    setConfirmed(true);
    try {
      const res = await fetch("/api/price-confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ venueId, priceGbp }),
      });
      if (res.ok) {
        const data = (await res.json()) as { confirms?: number };
        if (typeof data.confirms === "number") setConfirms(data.confirms);
      }
    } catch {
      // Fail-soft: the optimistic confirmed state stays put on any error.
    }
  }, [confirmed, venueId, priceGbp]);

  const countLabel =
    confirms !== null ? `${confirms} ${confirms === 1 ? "confirm" : "confirms"}` : "";

  // One persistent <button> across idle → confirmed so keyboard focus is never
  // dropped (a node swap would send focus to <body>). Confirmed is announced via
  // the adjacent sr-only live region.
  return (
    <div className="vpsConfirm">
      <button
        type="button"
        className={confirmed ? "vpsConfirmBtn vpsConfirmDone" : "vpsConfirmBtn"}
        onClick={confirm}
        aria-pressed={confirmed}
        aria-label={
          confirmed
            ? `Confirmed a pint here is still ${priceLabel}`
            : `Confirm a pint here is still ${priceLabel}`
        }
      >
        <ConfirmTick />
        <span className="vpsConfirmText">
          {confirmed ? "Confirmed just now" : `Still ${priceLabel}?`}
          {confirmed && countLabel ? <span className="vpsConfirmCount"> · {countLabel}</span> : null}
        </span>
      </button>
      {confirmed ? (
        <span className="srOnly" role="status">
          Confirmed{countLabel ? ` · ${countLabel}` : ""}.
        </span>
      ) : null}
    </div>
  );
}

type VenuePriceStoryProps = {
  venue: Venue;
  drops: VenuePriceStoryDrop[];
};

export default function VenuePriceStory({ venue, drops }: VenuePriceStoryProps) {
  const story = computeVenuePriceStory(venue, drops);

  if (story.isEmpty) {
    return (
      <section className="venuePriceStory" aria-labelledby="vpsTitle">
        <div className="inspectorTitle">
          <TrendingUp size={16} />
          <span id="vpsTitle">The Golden Thread</span>
        </div>
        <p className="description muted">
          No price story on record for {venue.name} yet. Log tonight&rsquo;s price — or pass down a
          dated memory (&ldquo;a pint here in 1985&hellip;&rdquo;) — and this pub&rsquo;s thread
          starts here.
        </p>
      </section>
    );
  }

  const { baseline, now, deltaGbp, pct, inflation } = story;
  // The freshest actionable price to vouch for: the community "now" price when
  // present, otherwise the baseline on record.
  const confirmTarget = now ?? baseline;
  const dir = deltaGbp !== null ? direction(deltaGbp) : "flat";
  const DirIcon = dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : Minus;

  return (
    <section className="venuePriceStory" aria-labelledby="vpsTitle">
      <div className="inspectorTitle">
        <TrendingUp size={16} />
        <span id="vpsTitle">The Golden Thread</span>
      </div>

      {/* Then vs Now: the baseline on record against the freshest community
          price. Data prices use stable badges; provenance keeps its own chip. */}
      {baseline || now ? (
        <div className="vpsPricePair">
          {baseline ? (
            <div className="vpsPriceGroup">
              <span className="vpsPriceLabel">{baseline.label}</span>
              <PriceBadge variant="baseline" className="vpsPriceValue vpsPriceThen">
                {formatPrice(baseline.gbp)}
              </PriceBadge>
              <ProvChip provenance={baseline.provenance} />
            </div>
          ) : null}
          {baseline && now ? (
            <span className="vpsArrow" aria-hidden="true">
              →
            </span>
          ) : null}
          {now ? (
            <div className="vpsPriceGroup">
              <span className="vpsPriceLabel">{now.label}</span>
              <PriceBadge
                variant={dir === "up" ? "increase" : "current"}
                className="vpsPriceValue vpsPriceNow"
              >
                {formatPrice(now.gbp)}
              </PriceBadge>
              <ProvChip provenance={now.provenance} />
            </div>
          ) : null}
        </div>
      ) : null}

      {baseline && now ? <StoryBars baseline={baseline} now={now} /> : null}

      {deltaGbp !== null && pct !== null ? (
        <p className={`vpsDelta vpsDelta-${dir}`}>
          <DirIcon size={15} aria-hidden="true" />
          <span aria-hidden="true">
            {dir === "flat"
              ? "No change from the baseline"
              : `${dir === "up" ? "+" : "−"}${formatPrice(Math.abs(deltaGbp))} (${Math.abs(
                  pct,
                ).toFixed(0)}%) vs baseline`}
          </span>
          <span className="srOnly">
            {dir === "flat"
              ? `The community price matches the ${formatPrice(baseline!.gbp)} baseline on record.`
              : `${dir === "up" ? "Up" : "Down"} ${formatPrice(Math.abs(deltaGbp))} (${Math.abs(
                  pct,
                ).toFixed(0)}%) from the ${formatPrice(
                  baseline!.gbp,
                )} baseline, community-reported.`}
          </span>
        </p>
      ) : null}

      {/* One-tap "still accurate?" community signal for the freshest actionable
          price (the community "now" price when present, else the baseline on
          record). Keyed by venue+price so the confirmed state never leaks across
          pubs (the component instance persists between selections). */}
      {confirmTarget ? (
        <PriceConfirmChip
          key={`${venue.id}:${Math.round(confirmTarget.gbp * 100)}`}
          venueId={venue.id}
          priceGbp={confirmTarget.gbp}
          priceLabel={formatPrice(confirmTarget.gbp)}
        />
      ) : null}

      {/* The inflation line — a dated, priced memory revalued into today's
          money. Provenance-badged: an anecdote is never mistaken for a fact. */}
      {inflation ? (
        <div className="vpsInflation">
          <p className="vpsInflationLine">
            A pint here was <strong>{formatPrice(inflation.thenGbp)}</strong> in{" "}
            <strong>{inflation.year}</strong> — that&rsquo;s{" "}
            <strong className="vpsToday">{formatPrice(inflation.todayGbp)}</strong> in{" "}
            {inflation.todayYear}&rsquo;s money.
          </p>
          <div className="vpsInflationMeta">
            <ProvChip provenance={inflation.provenance} />
            <span className="vpsInflationBy">passed down by {inflation.handle}</span>
          </div>
        </div>
      ) : null}

      <p className="vpsFootnote">
        Baseline = dataset price on record · Now = community-reported · inflation revalued via UK CPI
      </p>
    </section>
  );
}
