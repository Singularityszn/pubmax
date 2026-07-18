"use client";

// "Drink like..." persona picker for the map's drink layer controls.
//
// Rides the existing drink-category filter path: selecting a persona hands the
// parent a PersonaDrink; the parent sets filters.drinkCategory to the persona's
// mapped category (so filterVenues + pubsToGeoJSON light the matching pins with
// zero new pin pipeline) and records the active persona for the card.
//
// Searchable, grouped person/fictional, fits-tonight-first (a quiet tag). Text
// and iconography only, never a likeness (PRD guardrail). No em dashes.

import { GlassWater, Search, Sparkles, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import type { DrinkCategory } from "@/lib/drinks";
import {
  buildPersonaPickerSections,
  loadPersonaDrinks,
  personaFitsCategory,
  type PersonaDrink,
} from "@/lib/personaDrinks";

import "./personaLens.css";

type PersonaLensPickerProps = {
  /** The active persona id, or null when the lens is off. */
  personaId: string | null;
  /** Selecting a persona, or null to clear the lens. */
  onSelect: (persona: PersonaDrink | null) => void;
  /** The DrinkCategory that fits tonight, for the fits-tonight sort/tag. */
  tonightCategory: DrinkCategory | null;
};

export default function PersonaLensPicker({
  personaId,
  onSelect,
  tonightCategory,
}: PersonaLensPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const personas = useMemo(() => loadPersonaDrinks(), []);
  const active = useMemo(
    () => personas.find((p) => p.id === personaId) ?? null,
    [personas, personaId],
  );
  const sections = useMemo(
    () => buildPersonaPickerSections({ personas, query, tonightCategory }),
    [personas, query, tonightCategory],
  );

  // Close on outside click / Escape, mirroring the app's popover idioms.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function choose(persona: PersonaDrink | null) {
    onSelect(persona);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="personaLensPicker" ref={rootRef}>
      <button
        type="button"
        className={active ? "personaLensTrigger isActive" : "personaLensTrigger"}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <GlassWater size={15} aria-hidden="true" />
        <span className="personaLensTriggerLabel">
          {active ? active.name : "Drink like..."}
        </span>
      </button>
      {active ? (
        <button
          type="button"
          className="personaLensClear"
          aria-label="Clear persona lens"
          onClick={() => choose(null)}
        >
          <X size={13} aria-hidden="true" />
        </button>
      ) : null}

      {open ? (
        <div className="personaLensPanel" role="dialog" aria-label="Drink like a persona">
          <div className="personaLensSearch">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              value={query}
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search people or drinks"
              aria-label="Search personas by name or drink"
              aria-controls={listId}
            />
          </div>

          <div className="personaLensList" id={listId} role="listbox">
            {active ? (
              <button
                type="button"
                className="personaLensOption personaLensOptionClear"
                onClick={() => choose(null)}
              >
                Clear selection
              </button>
            ) : null}

            {sections.length === 0 ? (
              <p className="personaLensEmpty">No personas match that search.</p>
            ) : null}

            {sections.map((section) => (
              <div key={section.kind} className="personaLensGroup">
                <p className="personaLensGroupLabel">{section.label}</p>
                {section.personas.map((persona) => {
                  const fits = personaFitsCategory(persona, tonightCategory);
                  const selected = persona.id === personaId;
                  return (
                    <button
                      key={persona.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={
                        selected
                          ? "personaLensOption isSelected"
                          : "personaLensOption"
                      }
                      onClick={() => choose(persona)}
                    >
                      <span className="personaLensOptionName">{persona.name}</span>
                      <span className="personaLensOptionMeta">
                        {persona.drink}
                        {fits ? (
                          <span className="personaLensFitsTag">
                            <Sparkles size={11} aria-hidden="true" />
                            fits tonight
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
