import {
  Beer,
  CircleDot,
  ForkKnife,
  Landmark,
  Martini,
  Route,
  Utensils,
} from "lucide-react";

import type {
  MapKeyEntry,
  MapPriceLegendModel,
} from "@/lib/mapPriceLegend";

import "./mapKey.css";

function ShapeIcon({ id }: { id: string }) {
  if (id === "pub-drink") return <Beer size={19} aria-hidden="true" />;
  if (id === "bar") return <Martini size={19} aria-hidden="true" />;
  if (id === "late-food") return <Utensils size={19} aria-hidden="true" />;
  if (id === "restaurant") return <ForkKnife size={19} aria-hidden="true" />;
  if (id === "base-pub") return <CircleDot size={19} aria-hidden="true" />;
  return <Landmark size={19} aria-hidden="true" />;
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
            aria-hidden="true"
          >
            {markerKind === "shape" ? (
              <ShapeIcon id={entry.id} />
            ) : markerKind === "route" ? (
              <Route size={18} />
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
      </section>

      <section className="mapKeySection" aria-labelledby="mapKeyClusterHeading">
        <h3 id="mapKeyClusterHeading">Clusters</h3>
        <div className="mapKeyClusterRow">
          <span className="mapKeyClusterSample" aria-hidden="true">
            #
          </span>
          <p>{legend.clusterNote}</p>
        </div>
      </section>

      <details className="mapKeyDetails">
        <summary>Pin shapes</summary>
        <EntryList entries={legend.shapes} markerKind="shape" />
        <p className="mapKeyNote">{legend.noAlcoholNote}</p>
      </details>

      <details className="mapKeyDetails">
        <summary>Dots and rings</summary>
        <EntryList entries={legend.marks} markerKind="mark" />
      </details>

      <details className="mapKeyDetails">
        <summary>Routes</summary>
        <EntryList entries={legend.routeMarks} markerKind="route" />
      </details>
    </div>
  );
}
