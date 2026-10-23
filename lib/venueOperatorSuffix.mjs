// The operator suffix a dataset files after a pub's name, written down once.
//
// Some lineages file a pub as "The Moon on the Hill - JD Wetherspoon" or "The
// Pennsylvanian (JD Wetherspoons)": the operator is spelling, not the pub's
// name. Two readers ask this one rule. scripts/lib/venueCanonicalization.mjs
// folds the suffix away to find the same pub filed twice, and
// lib/venueDisplay.ts drops it from the name a reader sees. Plain ESM with a
// `.d.mts` sidecar so the plain-node canonicalizer and the app share it.
//
// Matches "- JD Wetherspoon", "(Wetherspoons)", "- Greene King", "- Young's",
// "- Fuller's", "- Nicholson's", "- Sam Smith's", "- Mitchells & Butlers",
// "- M&B" and "- Stonegate", and everything after it.
export const OPERATOR_SUFFIX_RE =
  /\s*[-–—(]\s*(jd\s+)?wetherspoons?\b.*$|\s*[-–—]\s*(greene\s+king|nicholson'?s|young'?s|fuller'?s|sam(uel)?\s+smith'?s?|mitchells?\s*&?\s*butlers?|m\s*&\s*b|stonegate)\b.*$/i;

export function hasOperatorSuffix(name) {
  return OPERATOR_SUFFIX_RE.test(String(name ?? ""));
}

/**
 * The name with any operator suffix removed. A name that is nothing BUT the
 * operator ("Wetherspoons") comes back as it was, because an empty name is
 * worse than a branded one.
 */
export function stripOperatorSuffix(name) {
  const raw = String(name ?? "");
  const stripped = raw.replace(OPERATOR_SUFFIX_RE, "").trim();
  return stripped || raw;
}
