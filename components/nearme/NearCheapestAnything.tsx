"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Footprints } from "lucide-react";

import { Chip } from "@/components/ui/chip";
import { formatGbp } from "@/lib/formatGbp";
import {
  cheapestDrinksNearby,
  NEAR_DRINK_CHIPS,
  nearDrinkAnswerHeading,
  nearDrinkEmptyLine,
  nearDrinkMeasureLabel,
  nearPintRows,
  type NearDrinkAnswer,
  type NearDrinkChipId,
  type NearDrinkLanes,
  type NearDrinkPoint,
} from "@/lib/nearCheapestAnything";
import { NEAR_GUINNESS_HREF } from "@/lib/nearMeAnswer";
import { nearPriceTrustLabel } from "@/lib/nearPriceTrust";
import { venueMapUrl } from "@/lib/venueMapUrl";

import "./nearPlayful.css";

/** The source half of a row, in the words every /near row uses. */
function sourceLine(answer: NearDrinkAnswer): string {
  return answer.publisher
    ? nearPriceTrustLabel("named", answer.publisher, answer.observedOn)
    : nearPriceTrustLabel("unrecorded", null, answer.observedOn);
}

function AnswerRow({ answer }: { answer: NearDrinkAnswer }) {
  return (
    <li className="nmnAnythingRow">
      <Link prefetch={false} className="nmnAnythingPub" href={venueMapUrl(answer.id)}>
        {answer.name}
      </Link>
      {/* The figure stays in ink: colour on a price is its pint band, and a
          wine, a coffee or a cola has no band. Its measure sits beside it. */}
      <span className="nmnAnythingFigure">
        {formatGbp(answer.priceGbp)}
        <span className="nmnAnythingMeasure"> · {nearDrinkMeasureLabel(answer.measure)}</span>
      </span>
      {answer.drinkLabel ? <span className="nmnAnythingDrink">{answer.drinkLabel}</span> : null}
      <span className="nmnAnythingMeta">
        <Footprints size={14} aria-hidden="true" /> {answer.walkMinutes} min walk
      </span>
      <span className="nmnAnythingSource">{sourceLine(answer)}</span>
    </li>
  );
}

/**
 * Cheapest anything: one chip per drink, each answering the cheapest listed
 * one within 15 minutes of the answer's centre (lib/nearCheapestAnything.ts).
 * `venues` is null while the index has not answered, and a lane missing from
 * `lanes` is one the build could not read, which is said as such.
 */
export default function NearCheapestAnything({
  centre,
  venues,
  lanes,
  initialChip = "pint",
}: {
  centre: { lat: number; lng: number };
  venues: readonly NearDrinkPoint[];
  lanes: NearDrinkLanes;
  initialChip?: NearDrinkChipId;
}) {
  const [chip, setChip] = useState<NearDrinkChipId>(initialChip);
  const pintRows = useMemo(() => nearPintRows(venues), [venues]);
  const rows = chip === "pint" ? pintRows : lanes[chip];
  const answers = useMemo(
    () => (rows ? cheapestDrinksNearby(centre.lat, centre.lng, venues, rows) : []),
    [centre.lat, centre.lng, rows, venues],
  );
  const entry = NEAR_DRINK_CHIPS.find((candidate) => candidate.id === chip) ?? NEAR_DRINK_CHIPS[0];

  return (
    <section className="nmnAnything" aria-labelledby="near-anything-title" data-testid="near-cheapest-anything">
      <h3 id="near-anything-title" className="nmnPlayfulTitle">Cheapest anything</h3>
      <div className="nmnAnythingChips" role="group" aria-label="Pick a drink">
        {NEAR_DRINK_CHIPS.map((candidate) => (
          <Chip
            key={candidate.id}
            aria-pressed={candidate.id === chip}
            onClick={() => setChip(candidate.id)}
          >
            {candidate.label}
          </Chip>
        ))}
      </div>
      <div className="nmnAnythingAnswer" aria-live="polite">
        <p className="nmnAnythingHeading">{nearDrinkAnswerHeading(chip)}</p>
        {!rows ? (
          <p className="nmnAnythingEmpty">We could not read listed {entry.answerNoun} prices just now.</p>
        ) : answers.length === 0 ? (
          <p className="nmnAnythingEmpty">{nearDrinkEmptyLine(chip)}</p>
        ) : (
          <>
            {answers.length > 1 ? (
              <p className="nmnAnythingNote">Each size is its own answer. A size is never compared with another.</p>
            ) : null}
            <ul className="nmnAnythingList">
              {answers.map((answer) => (
                <AnswerRow key={`${answer.measure ?? "unstated"}-${answer.id}`} answer={answer} />
              ))}
            </ul>
          </>
        )}
        {chip === "guinness" ? (
          <p className="nmnAnythingMore">
            <Link prefetch={false} href={NEAR_GUINNESS_HREF}>Every listed Guinness</Link>
          </p>
        ) : null}
      </div>
    </section>
  );
}
