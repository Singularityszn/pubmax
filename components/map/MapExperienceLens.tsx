"use client";

import { GlassWater, Map, Utensils } from "lucide-react";

import type { MapExperienceLens as MapExperienceLensValue } from "@/lib/mapExperienceLens";

import "./mapExperienceLens.css";

const OPTIONS = [
  { id: "all", label: "All", Icon: Map },
  { id: "no-alcohol", label: "No alcohol", Icon: GlassWater },
  { id: "food", label: "Food", Icon: Utensils },
] as const;

export default function MapExperienceLens({
  lens,
  allSelected = true,
  summary,
  onChange,
}: {
  lens: MapExperienceLensValue;
  allSelected?: boolean;
  summary: string;
  onChange: (lens: MapExperienceLensValue) => void;
}) {
  return (
    <section className="mapExperienceLens" aria-labelledby="mapExperienceLensTitle">
      <div className="mapExperienceLensHead">
        <span id="mapExperienceLensTitle">Show me</span>
        <small>Prices and places for your night</small>
      </div>
      <div className="mapExperienceLensOptions" role="group" aria-label="Map view">
        {OPTIONS.map(({ id, label, Icon }) => {
          const selected = lens === id && (id !== "all" || allSelected);
          return (
            <button
              key={id}
              type="button"
              className={
                selected
                  ? "mapExperienceLensOption isSelected"
                  : "mapExperienceLensOption"
              }
              aria-pressed={selected}
              onClick={() => onChange(id)}
            >
              <Icon size={17} aria-hidden="true" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
      {summary ? (
        <p className="mapExperienceLensSummary" role="status" aria-live="polite">
          {summary}
        </p>
      ) : null}
    </section>
  );
}
