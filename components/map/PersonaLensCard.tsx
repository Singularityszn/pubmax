"use client";

// The persona card for an active "Drink like..." lens. Follows the venue-sheet
// idioms (role tokens, panel-raised surface, brass accents) and renders as a
// bottom-anchored sheet card at 390x844 and a side drawer card on desktop, both
// themes. Text + iconography only, never a likeness (PRD guardrail).
//
// Framing copy is always "reported favourite" (real people) or "as ordered in
// [work]" (fictional), and the fixed disclaimer ships on the surface. No em
// dashes anywhere.

import { ExternalLink, X } from "lucide-react";

import { DrinkGlyph } from "@/components/drinks/DrinkGlyph";
import { categoryLabel } from "@/lib/drinks";
import { PERSONA_DISCLAIMER, type PersonaDrink } from "@/lib/personaDrinks";

import styles from "./personaLens.module.css";

type PersonaLensCardProps = {
  persona: PersonaDrink;
  /** Count of pubs currently matching the lens, for the pub-tie line. */
  matchCount?: number;
  onClose: () => void;
};

function framingLine(persona: PersonaDrink): string {
  if (persona.kind === "fictional") return `As ordered in ${persona.sourceName}`;
  return "Reported favourite";
}

export default function PersonaLensCard({
  persona,
  matchCount,
  onClose,
}: PersonaLensCardProps) {
  const hasIngredients = persona.ingredients.length > 0;
  return (
    <aside
      className={styles.personaLensCard}
      aria-label={`Drink like ${persona.name}`}
    >
      <div className={styles.personaLensCardHead}>
        <span className={styles.personaLensCardEyebrow}>{framingLine(persona)}</span>
        <button
          type="button"
          className={styles.personaLensCardClose}
          onClick={onClose}
          aria-label="Close persona lens"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className={styles.personaLensCardTitle}>
        <DrinkGlyph category={persona.drinkCategory} size={30} />
        <div>
          <h2 className={styles.personaLensCardName}>{persona.name}</h2>
          <p className={styles.personaLensCardKnownFor}>{persona.knownFor}</p>
        </div>
      </div>

      <div className={styles.personaLensCardDrink}>
        <strong className={styles.personaLensCardDrinkName}>{persona.drink}</strong>
        <span className={styles.personaLensCardCategory}>
          {categoryLabel(persona.drinkCategory)}
        </span>
      </div>

      {typeof matchCount === "number" ? (
        <p className={styles.personaLensCardPubTie}>
          {matchCount === 0
            ? "No pubs on the map match this drink right now."
            : matchCount === 1
              ? "1 pub on the map pours it."
              : `${matchCount} pubs on the map pour it.`}
        </p>
      ) : null}

      {hasIngredients ? (
        <ul className={styles.personaLensCardIngredients} aria-label="Ingredients">
          {persona.ingredients.map((ingredient) => (
            <li key={ingredient} className={styles.personaLensCardIngredient}>
              {ingredient}
            </li>
          ))}
        </ul>
      ) : null}

      <p className={styles.personaLensCardOrder}>
        <span className={styles.personaLensCardOrderLabel}>How to order</span>
        {persona.howToOrder}
      </p>

      <p className={styles.personaLensCardWhy}>{persona.why}</p>

      <a
        className={styles.personaLensCardSource}
        href={persona.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        {persona.sourceName}
        <ExternalLink size={13} aria-hidden="true" />
      </a>

      <p className={styles.personaLensCardDisclaimer}>{PERSONA_DISCLAIMER}</p>
    </aside>
  );
}
