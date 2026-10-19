"use client";

import { useEffect, useState, type CSSProperties } from "react";

import { PubPalMascot } from "@/components/pal/PubPalMascot";
import { formatGbp } from "@/lib/formatGbp";
import { readLocalPal } from "@/lib/localPal";
import { palGenomeFor, palGenomeStyle } from "@/lib/palGenome";
import {
  PRICE_BANDS,
  priceBand,
  priceBandAreaForVenue,
  priceBandBasisFor,
  priceBandClass,
  priceBandLabel,
} from "@/lib/priceBand";
import type { PubPal } from "@/lib/pubPal";
import { pubPalMascotSlugFor } from "@/lib/pubPalMascot";
import { pintNeedleAngle, pintNeedleArc, pintNeedlePosition } from "./pintNeedle";
import "./venuePintNeedle.css";

// Where this pub's pint sits against its city: a half-dial of the city's three
// price bands, with a needle at the pint. It reads the same thresholds and
// the same band the pub's pin is painted with (lib/priceBand.ts), so the dial
// and the pin can never disagree, and it draws only a pint the Overview
// already shows. The person's own Pal, if they have one and it is not hidden,
// sits at the dial's pivot, and hops when the pint is cheap. No Pal says
// anything about a price.

const CX = 100;
const CY = 100;
const RADIUS = 78;

export default function VenuePintNeedle({ venueId, priceGbp }: { venueId: string; priceGbp: number | null | undefined }) {
  const [pal, setPal] = useState<PubPal | null>(null);
  useEffect(() => {
    const stored = readLocalPal();
    queueMicrotask(() => setPal(stored && !stored.hidden && pubPalMascotSlugFor(stored.appearance.species) ? stored : null));
  }, []);

  const area = priceBandAreaForVenue(venueId);
  const band = priceBand(priceGbp, area);
  if (band === null || typeof priceGbp !== "number") return null;
  const { thresholds, basis } = priceBandBasisFor(area);
  const position = pintNeedlePosition(priceGbp, thresholds);
  const label = priceBandLabel(band);
  const against = basis === "city" ? "against this city's priced pints" : "against every priced pint we hold";

  return (
    <figure
      className={`venuePintNeedle ${priceBandClass(band)}`}
      data-band={band}
      data-testid="venue-pint-needle"
    >
      <svg
        className="venuePintNeedleDial"
        viewBox="0 0 200 116"
        role="img"
        aria-label={`${formatGbp(priceGbp)} is ${label.toLowerCase()} ${against}.`}
      >
        {PRICE_BANDS.map((name, index) => (
          <path key={name} className={`venuePintNeedleArc venuePintNeedleArc--${name}`} d={pintNeedleArc(index as 0 | 1 | 2, CX, CY, RADIUS)} />
        ))}
        <g className="venuePintNeedleHand" style={{ "--needle-angle": `${pintNeedleAngle(position)}deg` } as CSSProperties}>
          <line x1={CX} y1={CY} x2={CX} y2={CY - RADIUS + 14} />
          <circle cx={CX} cy={CY - RADIUS + 14} r={5} />
        </g>
        <circle className="venuePintNeedleHub" cx={CX} cy={CY} r={9} />
      </svg>
      {pal ? (
        <span
          className={"venuePintNeedlePal" + (band === "cheap" ? " isCheering" : "")}
          aria-hidden="true"
          data-pal-state={pal.muted ? "sleeping" : undefined}
          style={palGenomeStyle(palGenomeFor(pal.id, pal.personality)) as CSSProperties}
        >
          <PubPalMascot species={pal.appearance.species} size={26} circular decorative className="venuePintNeedleFace" />
        </span>
      ) : null}
      <figcaption className="venuePintNeedleCaption">
        <strong className="venuePintNeedleBand">{label}</strong>
        <span className="venuePintNeedleAgainst type-meta">{against}</span>
      </figcaption>
    </figure>
  );
}
