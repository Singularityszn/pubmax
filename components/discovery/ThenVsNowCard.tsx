import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import PriceBadge from "@/components/PriceBadge";
import { drinkMeasureName } from "@/lib/drinkMeasure";
import { venueMapUrl } from "@/lib/venueMapUrl";
import { formatPrice } from "@/lib/venues";
import type { ThenVsNowItem } from "@/lib/thenVsNow";

// A single "Then vs Now" price card: the pub name (linked into /map?sel=…), a
// compact baseline observation next to the freshest community observation.
// Movement appears only when the comparison leaf established exact evidence.

type ThenVsNowCardProps = {
  item: ThenVsNowItem;
};

// Round to the penny for the direction test so a £0.004 float wobble never
// paints a "went up" arrow on what is effectively no change.
function direction(deltaGbp: number): "up" | "down" | "flat" {
  const pennies = Math.round(deltaGbp * 100);
  if (pennies > 0) return "up";
  if (pennies < 0) return "down";
  return "flat";
}

function observationDate(value: string | null): string {
  if (!value) return "Date not recorded";
  const time = Date.parse(value);
  return Number.isFinite(time)
    ? new Date(time).toISOString().slice(0, 10)
    : "Date not recorded";
}

function datasetObservationLabel(
  thenObservedAt: string | null,
  nowObservedAt: string | null,
): string {
  const thenTime = Date.parse(thenObservedAt ?? "");
  const nowTime = Date.parse(nowObservedAt ?? "");
  return Number.isFinite(thenTime) &&
    Number.isFinite(nowTime) &&
    thenTime < nowTime
    ? "Earlier observation"
    : "Dataset observation";
}

function observationServing(
  measure: ThenVsNowItem["thenMeasure"],
  label: string,
): string {
  return measure ? drinkMeasureName(measure, label) : "Serving not recorded";
}

function priceTerms(
  condition: ThenVsNowItem["thenPriceCondition"],
  terms: string,
): string {
  if (condition === "regular") return "Regular price";
  if (condition === "promotion") {
    return terms ? `Promotion: ${terms}` : "Promotion terms not recorded";
  }
  return "Price terms not recorded";
}

function baselineSourceLabel(sourceUrl: string | null): string {
  if (!sourceUrl) return "Dataset source";
  const host = new URL(sourceUrl).hostname.replace(/^www\./, "");
  return host === "pint-prices.com" ? "Pint Prices" : host;
}

export default function ThenVsNowCard({ item }: ThenVsNowCardProps) {
  const comparable = item.deltaGbp !== null && item.pct !== null;
  const dir = direction(item.deltaGbp ?? 0);
  const abs = Math.abs(item.deltaGbp ?? 0);
  const pctAbs = Math.abs(item.pct ?? 0);
  const href = venueMapUrl(item.venueId);

  // A screen-reader sentence that reads the movement plainly, out of context.
  const movementLabel = !comparable
    ? "No price-change comparison. The observations do not share exact evidence."
    : dir === "flat"
      ? `No change from the earlier ${formatPrice(item.thenGbp)} price.`
      : `${dir === "up" ? "Up" : "Down"} ${formatPrice(abs)} (${pctAbs.toFixed(
          0,
        )}%) from the earlier ${formatPrice(item.thenGbp)} price, community-reported.`;

  const DirIcon = dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : Minus;

  return (
    <article className="tvnCard" data-reveal>
      <h3 className="tvnName">
        <Link prefetch={false} href={href} className="tvnLink">
          {item.venueName}
        </Link>
      </h3>

      <div className="tvnCompareRow">
        <div className="tvnPriceGroup">
          <span className="tvnPriceLabel">
            {datasetObservationLabel(item.thenObservedAt, item.nowObservedAt)}
          </span>
          <span className="tvnObservationDrink">
            {item.thenDrink || "Drink not recorded"}
          </span>
          <span className="tvnObservationMeta">
            {observationServing(item.thenMeasure, item.thenMeasureLabel)} ·{" "}
            {observationDate(item.thenObservedAt)}
          </span>
          <PriceBadge variant="baseline">{formatPrice(item.thenGbp)}</PriceBadge>
          <span className="tvnObservationMeta">
            {priceTerms(item.thenPriceCondition, item.thenPriceTerms)}
          </span>
          <span className="tvnObservationSource">
            {item.thenSourceId && item.thenSourceUrl ? (
              <a href={item.thenSourceUrl} target="_blank" rel="noreferrer">
                {baselineSourceLabel(item.thenSourceUrl)}
              </a>
            ) : item.thenSourceId ? (
              "Dataset source link not recorded"
            ) : (
              "Source not recorded"
            )}
          </span>
        </div>
        <span className="tvnArrow" aria-hidden="true">
          →
        </span>
        <div className="tvnPriceGroup">
          <span className="tvnPriceLabel">Community observation</span>
          <span className="tvnObservationDrink">
            {item.nowDrink || "Drink not recorded"}
          </span>
          <span className="tvnObservationMeta">
            {observationServing(item.nowMeasure, item.nowMeasureLabel)} ·{" "}
            {observationDate(item.nowObservedAt)}
          </span>
          <PriceBadge variant={comparable && dir === "up" ? "increase" : "current"}>
            {formatPrice(item.nowGbp)}
          </PriceBadge>
          <span className="tvnObservationMeta">
            {priceTerms(item.nowPriceCondition, item.nowPriceTerms)}
          </span>
          <span className="tvnObservationSource">
            {item.nowSourceId ? (
              <Link prefetch={false} href={`/p/${encodeURIComponent(item.nowSourceId)}`}>
                Pint Drop{item.nowHandle ? ` by ${item.nowHandle}` : ""}
              </Link>
            ) : (
              "Source not recorded"
            )}
          </span>
        </div>
      </div>

      {comparable ? (
        <p className={`tvnDelta tvnDelta-${dir}`}>
          <DirIcon size={15} aria-hidden="true" />
          <span aria-hidden="true">
            {dir === "flat"
              ? "No change"
              : `${dir === "up" ? "+" : "−"}${formatPrice(abs)} (${pctAbs.toFixed(0)}%)`}
          </span>
          <span className="srOnly">{movementLabel}</span>
        </p>
      ) : (
        <p className="tvnDelta tvnDelta-independent">
          No price-change comparison. Drink, serving, dates and price terms must match.
        </p>
      )}
    </article>
  );
}
