"use client";

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

/**
 * The correction door: "It's changed" opens the Pint Drop composer, because a
 * correction IS a new dated observation by a named drinker.
 *
 * It is what remains of the old one-tap confirm chip, which battle test L03
 * retired (see the header note). The chip printed "Confirmed - 1 confirm."
 * beside a price the trust chip called logged-once, on an anonymous tally that
 * no independence rule could ever read. This door writes through the one lane
 * that can be trusted: a drinker with an account, an authority key and a
 * dated row.
 */
function PriceChangedDoor({ onPriceChanged }: { onPriceChanged: () => void }) {
  return (
    <div className="vpsConfirm">
      <button
        type="button"
        className="vpsChangedBtn"
        onClick={onPriceChanged}
        aria-label="The price has changed. Log the new price for this pub"
      >
        It&rsquo;s changed
      </button>
    </div>
  );
}

type VenuePriceStoryProps = {
  venue: Venue;
  drops: VenuePriceStoryDrop[];
  /** "It's changed" routes here — the correction IS a new drop (opens the composer). */
  onPriceChanged?: () => void;
};

export default function VenuePriceStory({ venue, drops, onPriceChanged }: VenuePriceStoryProps) {
  const story = computeVenuePriceStory(venue, drops);

  if (story.isEmpty) {
    return (
      <section className="venuePriceStory" aria-labelledby="vpsTitle">
        <div className="inspectorTitle">
          <TrendingUp size={16} />
          <span id="vpsTitle">The Golden Thread</span>
        </div>
        <p className="description muted">
          No price story on record for {venue.name}{" "}yet. Log tonight&rsquo;s price, or pass down a
          dated memory (&quot;a pint here in 1985&hellip;&quot;), and this pub&rsquo;s thread
          starts here.
        </p>
      </section>
    );
  }

  const { baseline, now, deltaGbp, pct, inflation } = story;
  // The freshest actionable price to vouch for: the community "now" price when
  // present, otherwise the baseline on record.

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
              ? "No change from the earlier price"
              : `${dir === "up" ? "+" : "−"}${formatPrice(Math.abs(deltaGbp))} (${Math.abs(
                  pct,
                ).toFixed(0)}%) vs earlier price`}
          </span>
          <span className="srOnly">
            {dir === "flat"
              ? `The community price matches the earlier ${formatPrice(baseline!.gbp)} price on record.`
              : `${dir === "up" ? "Up" : "Down"} ${formatPrice(Math.abs(deltaGbp))} (${Math.abs(
                  pct,
                ).toFixed(0)}%) from the ${formatPrice(
                  baseline!.gbp,
                )} earlier price, community-reported.`}
          </span>
        </p>
      ) : null}

      {/* The correction door. A price that has moved is logged as a new dated
          observation by a named drinker, never vouched anonymously (L03). */}
      {onPriceChanged ? <PriceChangedDoor onPriceChanged={onPriceChanged} /> : null}

      {/* The inflation line — a dated, priced memory revalued into today's
          money. Provenance-badged: an anecdote is never mistaken for a fact. */}
      {inflation ? (
        <div className="vpsInflation">
          <p className="vpsInflationLine">
            A pint here was <strong>{formatPrice(inflation.thenGbp)}</strong> in{" "}
            <strong>{inflation.year}</strong>. That&rsquo;s{" "}
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
        The earlier price is the one on record. The newer one is a community report. We adjust old prices for inflation with UK CPI.
      </p>
    </section>
  );
}
