import {
  Beer,
  CircleDot,
  ForkKnife,
  Landmark,
  Martini,
  Utensils,
} from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";

import type {
  MapKeyEntry,
  MapPriceLegendModel,
} from "@/lib/mapPriceLegend";
import { mapPriceTrustBeats } from "@/lib/mapPriceTrust";
import { priceBandClass } from "@/lib/priceBand";

import "./mapKey.css";

function ShapeIcon({ id }: { id: string }) {
  if (id === "pub-drink") return <Beer size={20} aria-hidden="true" />;
  if (id === "bar") return <Martini size={20} aria-hidden="true" />;
  if (id === "late-food") return <Utensils size={20} aria-hidden="true" />;
  if (id === "restaurant") return <ForkKnife size={20} aria-hidden="true" />;
  if (id === "base-pub") return <CircleDot size={20} aria-hidden="true" />;
  return <Landmark size={20} aria-hidden="true" />;
}

function EntryList({
  entries,
  markerKind,
}: {
  entries: MapKeyEntry[];
  markerKind: "shape" | "mark" | "route";
}) {
  return (
    <ul className="mapKeyList">
      {entries.map((entry) => (
        <li key={entry.id} className="mapKeyItem">
          <span
            className={`mapKeyMarker mapKeyMarker--${markerKind} mapKeyMarker--${entry.id}`}
            style={
              entry.colour
                ? ({
                    "--map-key-marker-colour": entry.colour,
                  } as CSSProperties)
                : undefined
            }
            aria-hidden="true"
          >
            {markerKind === "shape" ? (
              <ShapeIcon id={entry.id} />
            ) : markerKind === "route" && entry.id === "crawl-stop" ? (
              <span className="mapKeyRouteStopNumber">1</span>
            ) : null}
          </span>
          <span>
            <strong>{entry.label}</strong>
            <small>{entry.detail}</small>
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function MapKey({
  legend,
}: {
  legend: MapPriceLegendModel;
}) {
  return (
    <div className="mapKey" aria-label="Map key">
      <section className="mapKeySection" aria-labelledby="mapKeyPriceHeading">
        <h3 id="mapKeyPriceHeading">{legend.title}</h3>
        <p>{legend.hint}</p>
        <ul className="mapKeyPriceRows">
          {legend.rows.map((row) => (
            <li key={row.label}>
              <i
                className={`mapKeyPriceSwatch mapKeyPriceSwatch--${row.tone}`}
                aria-hidden="true"
              />
              <span className="mapKeyPriceCode">{row.symbol}</span>
              <span>{row.label}</span>
            </li>
          ))}
        </ul>
        <details className="mapKeyDetails mapKeyDetails--trust">
          <summary>Why this colour?</summary>
          <ul className="mapKeyTrustList">
            {mapPriceTrustBeats().map((beat) => (
              <li key={beat.id}>
                <strong>{beat.title}</strong>
                <small>{beat.detail}</small>
              </li>
            ))}
          </ul>
        </details>
        {/* What people are SAYING about prices lives on its own page, one tap
            away. It is a door, never a layer: a Price Pulse figure has no
            price authority and never paints a pin (lib/pricePulse.ts). */}
        <Link prefetch={false} href="/price-pulse" className="mapKeyPulseLink">
          What people are saying about prices
        </Link>
      </section>

      {legend.cluster ? (
        <section className="mapKeySection" aria-labelledby="mapKeyClusterHeading">
          <h3 id="mapKeyClusterHeading">Clusters</h3>
          <div className="mapKeyClusterRow">
            <span className="mapKeyClusterSample" aria-hidden="true">
              {legend.cluster.samplePriced ? (
                // A priced disc's figure wears its own band's ink, so the
                // sample does too: the cheap band, the one "£4" sits in.
                <span className={priceBandClass("cheap")}>{legend.cluster.sample}</span>
              ) : (
                legend.cluster.sample
              )}
            </span>
            <p>{legend.cluster.note}</p>
          </div>
        </section>
      ) : null}

      {legend.shapes.length > 0 ? (
        <details className="mapKeyDetails">
          <summary>Pin shapes</summary>
          <EntryList entries={legend.shapes} markerKind="shape" />
          {legend.noAlcoholNote ? (
            <p className="mapKeyNote">{legend.noAlcoholNote}</p>
          ) : null}
        </details>
      ) : null}

      {legend.marks.length > 0 ? (
        <details className="mapKeyDetails">
          <summary>Dots and rings</summary>
          <EntryList entries={legend.marks} markerKind="mark" />
        </details>
      ) : null}

      {legend.routeMarks.length > 0 ? (
        <details className="mapKeyDetails">
          <summary>Routes</summary>
          <EntryList entries={legend.routeMarks} markerKind="route" />
        </details>
      ) : null}
    </div>
  );
}
