"use client";

import { ArrowDownRight, ArrowUpRight, Minus, TrendingUp } from "lucide-react";

import PriceBadge from "@/components/PriceBadge";
import { formatPrice, type Venue } from "@/lib/venues";
import type { Provenance } from "@/lib/curation";
import { PROVENANCE_LABEL } from "@/lib/provenanceLabels";
import { formatObservedDate } from "@/lib/dataFreshness";
import {
  computeVenuePriceStory,
  type VenuePriceStamp,
  type VenuePriceStoryDrop,
} from "@/lib/thenVsNow";

import "./venuePriceStory.css";
import { formatDrinkTagName } from "@/lib/drinkTagName";

// Each figure keeps the drink, serving, attribution and date from its own
// record. Only comparable observations show a price change. A memory's era
// cannot date its price. Demo and anecdotal provenance remain separate.

function ProvChip({ provenance }: { provenance: Provenance }) {
  return <span className={`provChip ${provenance}`}>{PROVENANCE_LABEL[provenance]}</span>;
}

function PriceEvidence({ stamp }: { stamp: VenuePriceStamp }) {
  const { drink, serving, publisher, sourceUrl, recordedAt, dateKind } = stamp.evidence;
  const at = recordedAt ? Date.parse(recordedAt) : Number.NaN;
  const date = Number.isFinite(at) ? formatObservedDate(new Date(at)) : null;
  return (
    <span className="vpsEvidence">
      <span>{drink ? formatDrinkTagName(drink) : "Drink not recorded"} · {serving ?? "Serving size not recorded"}</span>
      <span>{publisher
        ? sourceUrl ? <a href={sourceUrl} target="_blank" rel="noopener noreferrer">{publisher}</a> : publisher
        : "Publisher not recorded"}</span>
      {stamp.evidence.linkUnavailable ? <span>Link unavailable</span> : null}
      <span>{date
        ? <>{dateKind === "read" ? "Source read" : "Logged"} <time dateTime={recordedAt!}>{date}</time></>
        : `${dateKind === "read" ? "Source read date" : "Log date"} unknown`}</span>
      {stamp.evidence.priceDateKnown === false ? <span>When this price was seen is not recorded.</span> : null}
    </span>
  );
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
        <span className="vpsBarLabel">Earlier</span>
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
  // The newest community observation is shown beside the baseline. Its label
  // says whether it is still fresh enough to describe as tonight's price.

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
              <PriceEvidence stamp={baseline} />
            </div>
          ) : null}
          {baseline && now && deltaGbp !== null ? (
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
              <PriceEvidence stamp={now} />
            </div>
          ) : null}
        </div>
      ) : null}

      {baseline && now && deltaGbp !== null ? <StoryBars baseline={baseline} now={now} /> : null}

      {baseline && now && deltaGbp === null ? (
        <p className="vpsFootnote">Price comparison unavailable. These records do not establish a change for the same drink and serving.</p>
      ) : null}

      {deltaGbp !== null && pct !== null ? (
        <p className={`vpsDelta vpsDelta-${dir}`}>
          <DirIcon size={16} aria-hidden="true" />
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

      {/* Reserved for an independently dated historical price. The current
          report contract cannot supply one, so the resolver returns null. */}
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
        Source reads and community reports do not confirm today&rsquo;s price. A memory&rsquo;s era does not date its logged price.
      </p>
    </section>
  );
}
