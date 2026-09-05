// Two pubs with one name are two pubs.
//
// Heritage facts are keyed by pub NAME, and London has several of almost every
// pub name. So one key collects facts about several pubs, and the join then
// hangs all of them on whichever venue the dataset happened to offer first.
// The Cheshire Cheese card was labelled Westminster over a description of a pub
// at 48 Crutched Friars in the City of London, and it is not alone: The Grapes
// carried a Wandsworth line under a Limehouse pub, and The Mitre in Richmond
// carried a Greenwich one.
//
// The rule is QUARANTINE, NEVER MERGE. A fact that names a London borough other
// than the borough of the venue it was joined to is about a different pub, so it
// is withheld from publication and reported, rather than printed over a card
// that contradicts it. A record left with nothing publishable is withheld
// whole: we would rather show no pub than the wrong one.
//
// What this catches is a STATED contradiction, which is what makes it safe to
// run without review: a fact that names no borough, or names a neighbourhood
// this module cannot resolve to one, is left alone rather than guessed at.
//
// Plain ESM with a .d.mts sidecar (the lib/pintIndexCanonical.mjs idiom), for
// the same reason lib/heritageDate.mjs is: the build script and validate-data
// are plain node, the app is TypeScript, and all three must agree.

import { LONDON_BOROUGH_NAMES } from "./londonBoroughNames.mjs";

function escapeForPattern(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const BOROUGH_PATTERNS = LONDON_BOROUGH_NAMES.map((name) => ({
  name,
  pattern: new RegExp(`\\b${escapeForPattern(name)}\\b`, "i"),
}));

/** Every canonical London borough this text NAMES, in canonical order. */
export function statedBoroughs(text) {
  const haystack = String(text ?? "");
  if (!haystack.trim()) return [];
  return BOROUGH_PATTERNS.filter((entry) => entry.pattern.test(haystack)).map(
    (entry) => entry.name,
  );
}

/**
 * The place a Wikipedia or Wikidata reference disambiguates itself by.
 * "…/wiki/The_Grapes,_Wandsworth" says out loud which Grapes it is about, and
 * that is stronger evidence of a fact's subject than the sentence often is.
 * Returns null for an undisambiguated article or a reference of another shape.
 */
export function referenceDisambiguator(sourceRef) {
  const ref = String(sourceRef ?? "");
  const match = ref.match(/\/wiki\/[^/?#]*?,_([^/?#]+)$/);
  if (!match) return null;
  return decodeURIComponent(match[1]).replace(/_/g, " ").trim() || null;
}

function sameBorough(a, b) {
  return String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
}

/**
 * Why a fact may not be published against this venue, or null when nothing
 * contradicts it.
 *
 * `venueBorough` is the geographic authority: it comes from the venue row the
 * record was joined to, which is the row the card's coordinates, map link and
 * borough label all come from. A fact that disagrees with it is not describing
 * that venue.
 */
export function heritagePlaceConflict({ text, sourceRef, venueBorough }) {
  const borough = String(venueBorough ?? "").trim();
  if (!borough) return null;

  const stated = statedBoroughs(text);
  if (stated.length > 0 && !stated.some((name) => sameBorough(name, borough))) {
    return {
      reason: "borough-stated-in-fact",
      stated: stated.join(", "),
      venueBorough: borough,
      why: `the fact places this pub in ${stated.join(", ")}, and the venue it was joined to is in ${borough}`,
    };
  }

  const disambiguator = referenceDisambiguator(sourceRef);
  if (disambiguator) {
    const disambiguatedBorough = LONDON_BOROUGH_NAMES.find((name) =>
      sameBorough(name, disambiguator),
    );
    if (disambiguatedBorough && !sameBorough(disambiguatedBorough, borough)) {
      return {
        reason: "borough-named-in-source-reference",
        stated: disambiguatedBorough,
        venueBorough: borough,
        why: `the source is the article for the ${disambiguatedBorough} pub of this name, and the venue it was joined to is in ${borough}`,
      };
    }
  }

  return null;
}

/**
 * Split a record's facts into what may be published against this venue and what
 * is quarantined. Nothing is edited and nothing is merged: a fact either
 * survives whole or is withheld whole, with the reason it was withheld.
 */
export function partitionFactsByPlace(facts, venueBorough) {
  const published = [];
  const quarantined = [];
  for (const fact of Array.isArray(facts) ? facts : []) {
    const conflict = heritagePlaceConflict({
      text: fact?.fact,
      sourceRef: fact?.sourceRef,
      venueBorough,
    });
    if (conflict) quarantined.push({ fact, conflict });
    else published.push(fact);
  }
  return { published, quarantined };
}
