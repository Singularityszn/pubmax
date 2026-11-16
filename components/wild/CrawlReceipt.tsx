"use client";

// THE CRAWL RECEIPT (wild idea 05, docs/plans/DESIGN_UX_PLAN.md section 12).
//
// The crawl's cost prints out of a till slot: every stop with its drink and
// its listed price, a round at every stop for however many of you there are,
// the split, the walk, and the honest footer. A stop with no listed price says
// so and stays out of the sum, and so does a planned stop the dataset no longer
// holds (lib/wildPintLineCrawl.ts holds the maths).
//
// Loaded on named routes through CrawlReceiptGate.tsx. The paper
// prints when the till scrolls into view: it slides down out of the slot in
// printer steps, a transform alone. With reduced motion it is simply there.

import { Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { BRAND_NAME } from "@/lib/brandNaming";
import { formatPence } from "@/lib/formatGbp";
import { priceBandClass } from "@/lib/priceBand";
import { prefersReducedMotion } from "@/lib/wildMode";
import {
  RECEIPT_MAX_PEOPLE,
  RECEIPT_MIN_PEOPLE,
  clampPeople,
  crawlPriceListing,
  crawlRound,
  formatKm,
  listedDaysText,
  missingStopsText,
  sourcesText,
  toPence,
  unsourcedText,
  type WildCrawl,
} from "@/lib/wildPintLineCrawl";

import "./crawlReceipt.css";

const PRINTED = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
});

/** A decorative barcode, the same bars for the same crawl every time. */
function Barcode({ seed }: { seed: string }) {
  const { bars, width } = useMemo(() => {
    let hash = 2166136261;
    for (const ch of seed) {
      hash ^= ch.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    const out: Array<{ x: number; w: number }> = [];
    let x = 0;
    while (x < 180) {
      hash = Math.imul(hash ^ (hash >>> 13), 1274126177) >>> 0;
      const w = 1 + (hash % 3);
      out.push({ x, w });
      x += w + 1 + ((hash >>> 5) % 3);
    }
    return { bars: out, width: x };
  }, [seed]);
  return (
    <svg className="crawlReceipt__barcode" viewBox={`0 0 ${width} 32`} preserveAspectRatio="none" aria-hidden="true">
      {bars.map((bar) => (
        <rect key={bar.x} x={bar.x} y={0} width={bar.w} height={32} />
      ))}
    </svg>
  );
}

type PrintState = "wait" | "run" | "done";

export default function CrawlReceipt({ crawl }: { crawl: WildCrawl }) {
  const uid = useId();
  const headingId = `${uid}-heading`;
  const tearId = `${uid}-tear`;
  const tillRef = useRef<HTMLDivElement>(null);
  const [people, setPeople] = useState(3);
  const [print, setPrint] = useState<PrintState>("wait");
  const [printed] = useState(() => new Date());

  // Print when the till comes into view, once. Reduced motion, or a browser
  // with no observer, gets the finished receipt.
  useEffect(() => {
    if (print !== "wait") return;
    const till = tillRef.current;
    if (!till || prefersReducedMotion() || typeof IntersectionObserver === "undefined") {
      setPrint("done");
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          setPrint("run");
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(till);
    return () => observer.disconnect();
  }, [print]);

  const printAgain = useCallback(() => {
    setPrint(prefersReducedMotion() ? "done" : "wait");
  }, []);

  const stops = crawl.stops;
  const round = crawlRound(stops, people, crawl.plannedStops);
  const listing = crawlPriceListing(stops);
  const listedDays = listedDaysText(listing);
  const listedBy = sourcesText(listing.sources);
  const unsourced = unsourcedText(listing.unsourced);
  const hasWalk = crawl.totalMinutes !== null && crawl.totalKm !== null;
  const priced = round.pricedStops > 0;
  /** Stops on the receipt with no listed price; the missing ones are said apart. */
  const listedUnpriced = round.unpricedStops - round.missingStops;
  const missing = missingStopsText(round.missingStops);
  const missingWarn = missing ? <p className="crawlReceipt__warn">{missing}</p> : null;

  return (
    <section className="crawlReceipt" aria-labelledby={headingId}>
      <h2 className="crawlReceipt__heading" id={headingId}>
        The crawl receipt
      </h2>
      <p className="crawlReceipt__dek">
        Selected pints subtotal. It covers one pint for each person at every{" "}
        {round.unpricedStops > 0 ? "priced " : ""}stop.
      </p>

      <div className="crawlReceipt__till" ref={tillRef}>
        <div className="crawlReceipt__mouth">
          <div
            className="crawlReceipt__paper"
            data-print={print}
            onAnimationEnd={(event) => {
              if (event.target === event.currentTarget) setPrint("done");
            }}
          >
            <div className="crawlReceipt__sheet">
              <p className="crawlReceipt__brand">{BRAND_NAME}</p>
              <p className="crawlReceipt__route">{crawl.name}</p>
              <p className="crawlReceipt__meta">
                Printed{" "}
                <time className="crawlReceipt__printedTime" dateTime={printed.toISOString()}>
                  {PRINTED.format(printed)}
                </time>
              </p>

              <hr className="crawlReceipt__rule" />

              <ol className="crawlReceipt__items">
                {stops.map((stop) => (
                  <li className="crawlReceipt__item" key={`${stop.position}-${stop.name}`}>
                    <span className="crawlReceipt__itemNum">{stop.position}</span>
                    <span className="crawlReceipt__itemName">{stop.name}</span>
                    {stop.pint ? (
                      <span className={`crawlReceipt__itemPrice ${priceBandClass(stop.pint.band)}`}>
                        {formatPence(toPence(stop.pint.priceGbp))}
                      </span>
                    ) : (
                      <span className="crawlReceipt__itemNone">No price yet</span>
                    )}
                    <span className="crawlReceipt__itemDrink">
                      {stop.pint ? `${stop.pint.drink}, a pint` : "Not listed, so not in the total"}
                    </span>
                    {stop.pint ? (
                      <span className="crawlReceipt__itemDrink">
                        {stop.pint.source ?? "Publisher not recorded"}.{" "}
                        {stop.pint.readDayLabel ? (
                          <>Read <time dateTime={stop.pint.readDay ?? undefined}>{stop.pint.readDayLabel}</time>.</>
                        ) : "Read date not recorded."}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>

              <hr className="crawlReceipt__rule" />

              {priced ? (
                <>
                  <p className="crawlReceipt__row">
                    <span>
                      A pint at {round.unpricedStops > 0 ? "each priced" : "every"} stop
                    </span>
                    <span className="crawlReceipt__sumValue">{formatPence(round.pintEachStopPence)}</span>
                  </p>
                  {listedUnpriced > 0 ? (
                    <p className="crawlReceipt__warn">
                      {listedUnpriced} {listedUnpriced === 1 ? "stop has" : "stops have"} no listed price, so the
                      total leaves {listedUnpriced === 1 ? "it" : "them"} out.
                    </p>
                  ) : null}
                  {missingWarn}

                  <div className="crawlReceipt__people" role="group" aria-label="How many of you are going">
                    <IconButton
                      type="button"
                      aria-label="One fewer person"
                      disabled={people <= RECEIPT_MIN_PEOPLE}
                      onClick={() => setPeople((value) => clampPeople(value - 1))}
                    >
                      <Minus size={20} aria-hidden="true" />
                    </IconButton>
                    <p className="crawlReceipt__peopleText">
                      <span className="crawlReceipt__peopleCount">{people}</span> {people === 1 ? "person" : "people"}
                    </p>
                    <IconButton
                      type="button"
                      aria-label="One more person"
                      disabled={people >= RECEIPT_MAX_PEOPLE}
                      onClick={() => setPeople((value) => clampPeople(value + 1))}
                    >
                      <Plus size={20} aria-hidden="true" />
                    </IconButton>
                  </div>

                  <div className="crawlReceipt__sums" aria-live="polite" aria-atomic="true">
                    {people > 1 ? (
                      <>
                        <p className="crawlReceipt__row crawlReceipt__row--total">
                          <span>
                            A round at {round.unpricedStops > 0 ? "each priced" : "every"} stop for{" "}
                            <span className="crawlReceipt__peopleCount">{people}</span>
                          </span>
                          <span className="crawlReceipt__sumValue" key={`round-${round.roundPence}`}>
                            {formatPence(round.roundPence)}
                          </span>
                        </p>
                        <p className="crawlReceipt__row">
                          <span>
                            Split <span className="crawlReceipt__peopleCount">{people}</span> ways
                          </span>
                          <span className="crawlReceipt__sumValue" key={`each-${people}`}>
                            {formatPence(round.eachPence)} each
                          </span>
                        </p>
                        <p className="crawlReceipt__small">
                          That is <span className="crawlReceipt__peopleCount">{round.pints}</span> pints, one each at
                          every {round.unpricedStops > 0 ? "priced " : ""}stop.
                        </p>
                      </>
                    ) : (
                      <p className="crawlReceipt__row crawlReceipt__row--total">
                        <span>Just you</span>
                        <span className="crawlReceipt__sumValue" key="each-1">
                          {formatPence(round.eachPence)}
                        </span>
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <p className="crawlReceipt__warn">
                    No stop on this crawl has a listed price yet, so there is nothing to add up.
                  </p>
                  {listedUnpriced > 0 ? (
                    <p className="crawlReceipt__warn">
                      {listedUnpriced} {listedUnpriced === 1 ? "stop has" : "stops have"} no listed price.
                    </p>
                  ) : null}
                  {missingWarn}
                </>
              )}

              <p className="crawlReceipt__row">
                <span>Walking</span>
                {hasWalk ? (
                  <span className="crawlReceipt__walkTime">
                    about {crawl.totalMinutes} min, {formatKm(crawl.totalKm!)}
                  </span>
                ) : (
                  <span>Not known</span>
                )}
              </p>
              <p className="crawlReceipt__small">
                {hasWalk
                  ? "A straight-line estimate. The streets add a bit."
                  : "We cannot place every stop, so we give no walking total."}
              </p>

              <hr className="crawlReceipt__rule" />

              {priced ? (
                <p className="crawlReceipt__foot">
                  Prices listed
                  {listedDays ? (
                    <>
                      {" "}
                      <span className="crawlReceipt__listedDate">{listedDays}</span>
                    </>
                  ) : null}
                  {listedBy ? ` by ${listedBy}` : ""}.
                  {listing.undated > 0
                    ? ` ${listing.undated} ${listing.undated === 1 ? "price has" : "prices have"} no read date.`
                    : ""}
                  {unsourced ? ` ${unsourced}` : ""}
                </p>
              ) : null}
              <p className="crawlReceipt__foot crawlReceipt__foot--strong">Pay what the bar charges.</p>
              <Barcode seed={crawl.name} />
            </div>
            <svg className="crawlReceipt__tear" width="100%" height="8" aria-hidden="true">
              <defs>
                <pattern id={tearId} width="12" height="8" patternUnits="userSpaceOnUse">
                  <path d="M0 0 H12 L6 8 Z" />
                </pattern>
              </defs>
              <rect width="100%" height="8" fill={`url(#${tearId})`} />
            </svg>
          </div>
        </div>
        <div className="crawlReceipt__slot" aria-hidden="true" />
      </div>

      <div className="crawlReceipt__actions">
        <Button type="button" variant="ghost" onClick={printAgain}>
          Print it again
        </Button>
      </div>
    </section>
  );
}
