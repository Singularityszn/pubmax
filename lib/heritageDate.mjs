// What a heritage DATE is, and what it is a date OF.
//
// A four-digit year lifted out of a cited sentence is not automatically the
// pub's own date. "named after the pirate William Kidd, who was hanged at the
// nearby Execution Dock in 1701" states a year, and the year belongs to the
// hanging. Reading it as the pub's date put The Captain Kidd among the oldest
// pubs in London and printed 1701 on its card as if the pub had stood there
// since then.
//
// So a date is THREE things and never a bare string: a VALUE, the PRECISION
// that value is known to, and the TYPE of event it dates. Only a type that is
// evidence of AGE may order a pub among the oldest, and every type states
// itself in the words the reader sees, so an event year can never be read as a
// founding year. A date we cannot type stays `unknown` and is never promoted.
//
// Plain ESM with a .d.mts sidecar (the lib/pintIndexCanonical.mjs idiom),
// because scripts/build_historic_index.mjs and scripts/validate-data.mjs are
// plain node and the app is TypeScript, and all three must answer the same way.
//
// Nothing here invents a date: a value is emitted only where the cited text
// states it, and a type only where the cited text carries the cue for it.

/** The closed set. A date we could not type is `unknown` and stays unknown. */
export const HERITAGE_DATE_TYPES = Object.freeze([
  "founding",
  "first_mention",
  "construction",
  "reopening",
  "associated_event",
  "unknown",
]);

/**
 * The types that are evidence of a pub's AGE, and so the only ones allowed to
 * order it among the oldest. A reopening dates a refit, an associated event
 * dates something that happened near the pub, and an untyped year dates nothing
 * we can name: none of the three says how old the pub is.
 */
export const AGE_EVIDENCE_DATE_TYPES = Object.freeze([
  "founding",
  "first_mention",
  "construction",
]);

/** True when this type may feed "oldest first" ordering and the age filters. */
export function heritageDateIsAgeEvidence(type) {
  return AGE_EVIDENCE_DATE_TYPES.includes(type);
}

/**
 * How near a cue must sit to a date to speak for it at all. Beyond this the cue
 * is somewhere else in the same clause and says nothing about the year.
 */
const HERITAGE_DATE_CUE_WINDOW = 60;

/**
 * The cue table. One rule, one type, one label word: the rule that TYPED the
 * date owns the word the reader sees, so a classification and its label cannot
 * drift apart. The NEAREST eligible cue speaks for the date; table order
 * settles an exact tie only, so the more specific rule wins when two cues touch
 * the same date. Distance decides first because one clause routinely states a
 * date and then says something else entirely: "the current building dates from
 * 1897 and its upstairs dining room is named after the writer George Orwell"
 * carries a construction cue against the year and a naming cue thirty
 * characters on, and only the near one is about 1897.
 */
export const HERITAGE_DATE_RULES = Object.freeze([
  {
    id: "reopening",
    type: "reopening",
    label: "Reopened",
    pattern: /\bre-?opened\b|\breopening\b/i,
  },
  {
    id: "named-after",
    type: "associated_event",
    label: "Named for",
    pattern: /\bnamed (?:after|for)\b|\btakes its name\b|\bcommemorat/i,
  },
  {
    id: "designation",
    type: "associated_event",
    label: "Listed",
    // Deliberately "listed IN", never a bare "listed": almost every cited
    // sentence carries "Grade II listed", and matching that would date a pub
    // to its listing rather than to its building.
    pattern: /\blisted in\b|\bdesignated\b|\bscheduled in\b/i,
  },
  {
    id: "event",
    type: "associated_event",
    label: "Linked to",
    pattern: /\bhanged\b|\bexecuted\b|\bdied\b|\bkilled\b|\bmurder/i,
  },
  {
    id: "damage",
    type: "associated_event",
    label: "Linked to",
    pattern:
      /\bbombed\b|\bbomb(?:ing|s)?\b|\bblitz\b|\bzeppelin\b|\braid\b|\bdamaged\b|\bdestroyed\b|\bburn(?:ed|t)\b|\bgreat fire\b|\bplague\b|\briot\b|\bsiege\b|\bbattle\b/i,
  },
  {
    id: "construction",
    type: "construction",
    label: "Built",
    pattern:
      /\bbuilt\b|\brebuilt\b|\berected\b|\bconstructed\b|\bdates? (?:back )?from\b|\bdating (?:back )?from\b|\bpresent building\b|\brefronted\b|\brefit\b/i,
  },
  {
    id: "dated-fabric",
    type: "construction",
    label: "Built",
    // An attributive century dates the thing it qualifies: "an 18th-century
    // timber-framed warehouse", "a mid-19th-century pub". The hyphen is what
    // makes it attributive, so "in the 18th and 19th centuries" (a pub that was
    // merely NOTABLE then) is left untyped rather than read as an age.
    pattern: /\b\d{1,2}(?:st|nd|rd|th)-centur(?:y|ies)\s+[a-z]/i,
  },
  {
    id: "first-mention",
    type: "first_mention",
    label: "First recorded",
    pattern:
      /\bfirst (?:recorded|mentioned|documented|licensed|noted)\b|\brecords? of\b|\brecorded (?:in|as)\b|\bmentioned in\b|\b(?:has |had )?stood on the (?:site|spot)\b|\btraded on the site\b|\breferences? to\b/i,
  },
  {
    id: "lifespan",
    type: "founding",
    label: "Founded",
    // A parenthesised span states when the place opened: "(1948-2008)", with
    // either dash character.
    pattern: /\(\s*1[4-9]\d{2}\s*[\u2013\u2014-]/,
  },
  {
    id: "founding",
    type: "founding",
    label: "Founded",
    pattern:
      /\bfounded\b|\bestablished\b|\bopened\b|\bopening\b|\borigins?\b|\btrading since\b|\binn since\b|\bpub (?:from|since)\b|\bdat(?:e|es|ed|ing) (?:back )?to\b|\bon the site since\b|\bsince\b/i,
  },
]);

const YEAR_PATTERN = /\b(1[4-9]\d{2})\b/g;
const CENTURY_PATTERN = /\b(\d{1,2})(?:st|nd|rd|th)[\s-]+centur(?:y|ies)\b/gi;

function ordinalSuffix(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

/**
 * The clause holding `index`, bounded by the nearest sentence or semicolon
 * break on each side, plus where `index` falls inside it. A cited heritage
 * sentence routinely states several dates of several kinds ("listed in 1977;
 * the tavern was rebuilt in the 1880s"), so the clause is the unit a cue may
 * speak for at all. Reading the whole paragraph would let one clause's verb
 * type another clause's year.
 */
export function heritageDateClauseAround(text, index) {
  const haystack = String(text ?? "");
  let start = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    const ch = haystack[i];
    if (ch === ";" || ch === "\n" || (ch === "." && !/\d/.test(haystack[i + 1] ?? ""))) {
      start = i + 1;
      break;
    }
  }
  let end = haystack.length;
  for (let i = index; i < haystack.length; i += 1) {
    const ch = haystack[i];
    if (ch === ";" || ch === "\n") {
      end = i;
      break;
    }
    // A full stop ends the clause only when it really ends a sentence: a
    // decimal point ("10.40pm") does not.
    if (ch === "." && !/\w/.test(haystack[i + 1] ?? "")) {
      end = i;
      break;
    }
  }
  return { clause: haystack.slice(start, end), index: index - start };
}

/** Every date the text STATES, in the order they appear. */
export function heritageDateCandidates(text) {
  const haystack = String(text ?? "");
  const out = [];
  for (const m of haystack.matchAll(YEAR_PATTERN)) {
    out.push({
      value: m[1],
      precision: "year",
      sortYear: Number(m[1]),
      index: m.index ?? 0,
    });
  }
  for (const m of haystack.matchAll(CENTURY_PATTERN)) {
    const n = Number(m[1]);
    if (n < 1) continue;
    out.push({
      value: `${n}${ordinalSuffix(n)} century`,
      precision: "century",
      sortYear: (n - 1) * 100,
      index: m.index ?? 0,
    });
  }
  out.sort((a, b) => a.index - b.index);
  return out;
}

// Distance from the nearest occurrence of a rule's cue to the date, or null
// when the clause carries that cue nowhere.
function cueDistance(rule, clause, dateIndex) {
  const scanner = new RegExp(
    rule.pattern.source,
    rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`,
  );
  let best = null;
  for (const m of clause.matchAll(scanner)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const distance = dateIndex < start ? start - dateIndex : Math.max(0, dateIndex - end);
    if (best === null || distance < best) best = distance;
  }
  return best;
}

/**
 * The rule that speaks for a date inside its clause, or null when no cue sits
 * near enough to. The nearest eligible cue wins; table order breaks an exact
 * tie, so the more specific rule speaks when two cues touch the same date.
 */
function heritageDateRuleFor(clause, dateIndex = 0) {
  let chosen = null;
  for (const rule of HERITAGE_DATE_RULES) {
    const distance = cueDistance(rule, clause, dateIndex);
    if (distance === null || distance > HERITAGE_DATE_CUE_WINDOW) continue;
    if (chosen === null || distance < chosen.distance) chosen = { rule, distance };
  }
  return chosen ? chosen.rule : null;
}

/** The public label. It always names the type, so a year never stands bare. */
function heritageDateLabel(date) {
  if (!date || !date.value) return null;
  return date.labelVerb ? `${date.labelVerb} ${date.value}` : date.value;
}

/**
 * Read the dates a cited text states and choose the one the record publishes.
 *
 * The chosen date is the EARLIEST that is evidence of age, because that is the
 * question "how old is this pub" asks. When the text states no age evidence at
 * all, the earliest stated date is chosen anyway and carries its own type, so
 * the reader still sees 1701 on The Captain Kidd, worded as the event it is.
 *
 * Returns null when the text states no date.
 */
export function classifyHeritageDate(text) {
  const haystack = String(text ?? "");
  const candidates = heritageDateCandidates(haystack).map((candidate) => {
    const { clause, index } = heritageDateClauseAround(haystack, candidate.index);
    const rule = heritageDateRuleFor(clause, index);
    const type = rule ? rule.type : "unknown";
    return {
      value: candidate.value,
      precision: candidate.precision,
      type,
      labelVerb: rule ? rule.label : null,
      sortYear: candidate.sortYear,
      ageEvidence: heritageDateIsAgeEvidence(type),
      // A year beats a century that sorts to the same start year, so "1700" is
      // not displaced by "18th century".
      rank: candidate.precision === "year" ? 0 : 1,
    };
  });
  if (candidates.length === 0) return null;

  const byAge = (a, b) => a.sortYear - b.sortYear || a.rank - b.rank;
  const aged = candidates.filter((c) => c.ageEvidence).sort(byAge);
  const chosen = aged[0] ?? [...candidates].sort(byAge)[0];

  return {
    value: chosen.value,
    precision: chosen.precision,
    type: chosen.type,
    label: heritageDateLabel(chosen),
    /** Sort key for "oldest first"; null when the date is not age evidence. */
    ageSortYear: chosen.ageEvidence ? chosen.sortYear : null,
  };
}
