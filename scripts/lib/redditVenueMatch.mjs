import { slugifyBorough } from "./areaNewsMatch.mjs";
import { coreTokens } from "./heritageMatch.mjs";

function nameMatches(pubTokens, venueName) {
  const vt = coreTokens(venueName);
  if (pubTokens.length === 0 || vt.length === 0) return false;
  if (pubTokens.every((t) => vt.includes(t))) return true;
  if (vt.every((t) => pubTokens.includes(t))) return true;
  return pubTokens.join(" ") === vt.join(" ");
}

function normalizeName(n) {
  return String(n ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function matchPubNameToVenue(pubName, boroughHint, venues) {
  if (!pubName) return null;
  const cleaned = pubName.replace(/\s+\bin\b.+$/i, "").trim();
  const pubTokens = coreTokens(cleaned);
  const normHint = normalizeName(cleaned);
  const slug = boroughHint ? slugifyBorough(boroughHint) : null;
  const scoped = slug
    ? venues.filter((v) => slugifyBorough(v.borough) === slug)
    : venues;
  const hits = scoped.filter((v) => nameMatches(pubTokens, v.name) || normalizeName(v.name) === normHint || normalizeName(v.name).startsWith(normHint));
  if (hits.length === 1) return { venueId: hits[0].id, confidence: slug ? "high" : "medium" };
  if (hits.length > 1) return null;
  if (slug) {
    const londonWide = venues.filter((v) => nameMatches(pubTokens, v.name));
    if (londonWide.length === 1) return { venueId: londonWide[0].id, confidence: "medium" };
  }
  return null;
}
