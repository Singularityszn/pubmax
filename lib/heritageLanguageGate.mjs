// Internal language may not be published.
//
// The Queens Arms card told every reader it was "a useful Victorian reference
// stop for the seeded heritage route". That sentence is a note to ourselves
// about why the record exists, written into the field a stranger reads as a
// fact about the pub. Nothing caught it, because a description is free text and
// free text was never checked.
//
// This is the check. It is a GATE, not a rewriter: it never edits a sentence,
// it refuses one and names the class it belongs to, so the fix is made at the
// source record by a person rather than papered over on the way out.
//
// Plain ESM with a .d.mts sidecar (the lib/pintIndexCanonical.mjs idiom):
// scripts/build_historic_index.mjs refuses the text on the way in and
// scripts/validate-data.mjs refuses it again over the shipped artifact, and
// both are plain node while the app is TypeScript.

/**
 * The closed rule table. One rule, one class, one reason: a refusal has to be
 * actionable, so it names WHY the sentence is internal rather than only that it
 * matched something.
 *
 * Every pattern here is deliberately narrow. A gate that also refuses honest
 * heritage prose gets switched off, and a gate that is off catches nothing.
 */
export const INTERNAL_LANGUAGE_RULES = Object.freeze([
  {
    id: "seed-language",
    why: "names our own seeding of the data, not the pub",
    pattern: /\bseed(?:ed|s|ing)?\b/i,
  },
  {
    id: "placeholder-marker",
    why: "carries an unfinished-work marker",
    pattern: /\b(?:TODO|FIXME|XXX|WIP|placeholder|lorem|ipsum|dummy|stub)\b/i,
  },
  {
    id: "template-language",
    why: "names a template rather than this pub",
    pattern: /\btemplat(?:e|es|ed)\b/i,
  },
  {
    id: "demo-language",
    why: "names demo content, which a public description may never be",
    pattern: /\bdemos?\b/i,
  },
  {
    id: "route-scaffolding",
    why: "describes the record's place in a route or crawl we built, not the pub",
    pattern:
      /\breference stop\b|\bheritage route\b|\bheritage crawl\b|\bcrawl seed\b|\bpub crawl seed\b/i,
  },
  {
    id: "internal-fit-note",
    why: "says how useful the record is to us, which is not a fact about the pub",
    pattern:
      /\b(?:strong |good |useful |perfect |nice )?fit for\b|\buseful (?:as|for) a\b|\bhandy (?:as|for) a\b|\bkeep(?:ing)? as a\b/i,
  },
  {
    id: "internal-review-note",
    why: "is a note to a reviewer about work still to do",
    pattern:
      /\bsoft match\b|\buntil the (?:exact|correct|real)\b|\bto be confirmed\b|\bTBC\b|\bneeds? a source\b|\bcheck this\b|\bpending (?:confirmation|verification|review)\b|\bawaiting (?:confirmation|verification)\b|\bcandidate (?:stop|venue|match|pub)\b/i,
  },
  {
    id: "test-fixture-language",
    why: "names test material",
    pattern:
      /\bsample (?:data|copy|text|record|entry|row)\b|\btest (?:data|record|row|fixture|pub|venue)\b|\bfor testing\b|\bfixture\b/i,
  },
]);

/**
 * Every internal-language finding in one piece of public copy, in table order.
 * An empty array means the text is publishable as far as this gate is
 * concerned.
 */
export function internalLanguageFindings(text) {
  const haystack = String(text ?? "");
  if (!haystack.trim()) return [];
  const findings = [];
  for (const rule of INTERNAL_LANGUAGE_RULES) {
    const match = haystack.match(rule.pattern);
    if (!match) continue;
    findings.push({ ruleId: rule.id, why: rule.why, match: match[0] });
  }
  return findings;
}

/** The first finding, or null. Enough to refuse; findings say the whole story. */
export function internalLanguageFinding(text) {
  return internalLanguageFindings(text)[0] ?? null;
}

/** True when this text may be shown to a stranger as a fact about a pub. */
export function isPublishableDescription(text) {
  return internalLanguageFindings(text).length === 0;
}

/** One line naming what was refused and why, for a build log or a test. */
export function describeInternalLanguage(finding) {
  if (!finding) return "";
  return `${finding.ruleId}: "${finding.match}" ${finding.why}`;
}
