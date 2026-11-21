"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { fairPintValueText, readFairPint, writeFairPint } from "@/lib/fairPint";
import { formatPence } from "@/lib/formatGbp";
import { trackEvent } from "@/lib/analytics";
import type { OpeningPreviewDisc } from "@/lib/mapOpeningPreviewDiscs";
import "./landingMapHero.css";

const subscribe = () => () => {};

export default function LandingMapHero({ discs }: { discs: OpeningPreviewDisc[] }) {
  const saved = useSyncExternalStore(subscribe, readFairPint, () => 550);
  const [chosen, setPence] = useState<number | null>(null);
  const pence = chosen ?? saved;

  return (
    <section className="landingMapHero" aria-labelledby="landing-map-title">
      <div className="landingMapHeroMap" role="img" aria-label="Map of central London with clusters that have a listed pint at or below your price">
        <div className="landingMapHeroGround" aria-hidden="true">
          {discs.filter((disc) => Math.round(disc.priceGbp * 100) <= pence).map((disc) => (
            <span key={disc.id} className="landingMapHeroPin" style={{ left: `${(disc.x + 322) / 644 * 100}%`, top: `${(disc.y + 848) / 1356 * 100}%` }} />
          ))}
        </div>
        <span className="landingMapHeroCredit">OpenFreeMap © OpenMapTiles · OpenStreetMap</span>
      </div>
      <div className="landingMapHeroCard">
        <h1 id="landing-map-title">What&apos;s a fair pint to you?</h1>
        <output className="landingMapHeroFigure" htmlFor="landing-fair-pint">{formatPence(pence)}</output>
        <input
          id="landing-fair-pint"
          type="range"
          min={300}
          max={800}
          step={10}
          value={pence}
          aria-label="Fair pint price"
          aria-valuetext={fairPintValueText(pence)}
          onChange={(event) => {
            const value = Number(event.currentTarget.value);
            setPence(value);
            writeFairPint(value);
          }}
        />
        <p>Dots show clusters with a listed pint at or below your price.</p>
        <Link data-primary-action="" className="landingMapHeroAction" href={chosen === null ? "/map" : `/map?max=${chosen / 100}`} prefetch={false} onClick={() => trackEvent("landing_cta_clicked", { target: "map" })}>Open the map</Link>
      </div>
    </section>
  );
}
