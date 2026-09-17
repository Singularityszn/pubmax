import {
  Beer,
  CircleDot,
  ForkKnife,
  Landmark,
  Martini,
  Utensils,
} from "lucide-react";
import type { CSSProperties } from "react";

import type {
  MapKeyEntry,
  MapPriceLegendModel,
} from "@/lib/mapPriceLegend";
import { mapPriceTrustBeats } from "@/lib/mapPriceTrust";

import styles from "./mapKey.module.css";

/** Convert a kebab-case id like "pint-drop" to PascalCase "PintDrop". */
function kebabToPascal(s: string): string {
  return s
    .split("-")
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join("");
}

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
  const kindClass =
    styles[`mapKeyMarker${kebabToPascal(markerKind)}`] ?? "";

  return (
    <ul className={styles.mapKeyList}>
      {entries.map((entry) => {
        const idClass =
          styles[`mapKeyMarker${kebabToPascal(entry.id)}`] ?? "";
        return (
          <li key={entry.id} className={styles.mapKeyItem}>
            <span
              className={`${styles.mapKeyMarker} ${kindClass} ${idClass}`}
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
                <span className={styles.mapKeyRouteStopNumber}>1</span>
              ) : null}
            </span>
            <span>
              <strong>{entry.label}</strong>
              <small>{entry.detail}</small>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default function MapKey({
  legend,
}: {
  legend: MapPriceLegendModel;
}) {
  return (
    <div className={styles.mapKey} aria-label="Map key">
      <section className={styles.mapKeySection} aria-labelledby="mapKeyPriceHeading">
        <h3 id="mapKeyPriceHeading">{legend.title}</h3>
        <p>{legend.hint}</p>
        <ul className={styles.mapKeyPriceRows}>
          {legend.rows.map((row) => {
            const toneClass =
              styles[
                `mapKeyPriceSwatch${row.tone.charAt(0).toUpperCase()}${row.tone.slice(1)}`
              ] ?? "";
            return (
              <li key={row.label}>
                <i
                  className={`${styles.mapKeyPriceSwatch} ${toneClass}`}
                  aria-hidden="true"
                />
                <span className={styles.mapKeyPriceCode}>{row.symbol}</span>
                <span>{row.label}</span>
              </li>
            );
          })}
        </ul>
        <details className={styles.mapKeyDetails}>
          <summary>Why this colour?</summary>
          <ul className={styles.mapKeyTrustList}>
            {mapPriceTrustBeats().map((beat) => (
              <li key={beat.id}>
                <strong>{beat.title}</strong>
                <small>{beat.detail}</small>
              </li>
            ))}
          </ul>
        </details>
      </section>

      {legend.clusterNote ? (
        <section className={styles.mapKeySection} aria-labelledby="mapKeyClusterHeading">
          <h3 id="mapKeyClusterHeading">Clusters</h3>
          <div className={styles.mapKeyClusterRow}>
            <span className={styles.mapKeyClusterSample} aria-hidden="true">
              #
            </span>
            <p>{legend.clusterNote}</p>
          </div>
        </section>
      ) : null}

      {legend.shapes.length > 0 ? (
        <details className={styles.mapKeyDetails}>
          <summary>Pin shapes</summary>
          <EntryList entries={legend.shapes} markerKind="shape" />
          {legend.noAlcoholNote ? (
            <p className={styles.mapKeyNote}>{legend.noAlcoholNote}</p>
          ) : null}
        </details>
      ) : null}

      {legend.marks.length > 0 ? (
        <details className={styles.mapKeyDetails}>
          <summary>Dots and rings</summary>
          <EntryList entries={legend.marks} markerKind="mark" />
        </details>
      ) : null}

      {legend.routeMarks.length > 0 ? (
        <details className={styles.mapKeyDetails}>
          <summary>Routes</summary>
          <EntryList entries={legend.routeMarks} markerKind="route" />
        </details>
      ) : null}
    </div>
  );
}
