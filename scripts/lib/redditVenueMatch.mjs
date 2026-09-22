import { slugifyBorough } from "./areaNewsMatch.mjs";
import { coreTokens } from "./heritageMatch.mjs";
import { LONDON_BOROUGH_NAMES } from "../../lib/londonBoroughNames.mjs";

function nameMatches(pubTokens, venueName) {
  const vt = coreTokens(venueName);
  if (pubTokens.length === 0 || vt.length === 0) return false;
  return pubTokens.length === vt.length && pubTokens.every((t) => vt.includes(t));
}

export function matchPubNameToVenue(pubName, boroughHint, venues) {
  if (!pubName || !boroughHint) return null;
  const cleaned = pubName.replace(/\s+\bin\b.+$/i, "").trim();
  const pubTokens = coreTokens(cleaned);
  const slug = slugifyBorough(boroughHint);
  const london = venues.filter((v) => LONDON_BOROUGH_NAMES.includes(v.borough));
  const scoped = london.filter((v) => slugifyBorough(v.borough) === slug);
  const hits = scoped.filter((v) => nameMatches(pubTokens, v.name));
  if (hits.length === 1) return { venueId: hits[0].id, confidence: "high" };
  if (hits.length > 1) return null;
  return null;
}
