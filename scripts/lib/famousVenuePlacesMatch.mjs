/**
 * Google Places (New) Text Search match rules for famous-venue re-verification.
 */

import { haversineMeters } from "./geo.mjs";

/** Folds case, diacritics, apostrophes, punctuation and a leading "the". */
export function normalizeVenueName(name) {
  return String(name)
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^the /, "");
}

/**
 * @returns {{ match: boolean; reason: string }}
 */
export function evaluateNameMatch(venueName, displayName, aliases = []) {
  const venueNorm = normalizeVenueName(venueName);
  const placeNorm = normalizeVenueName(
    typeof displayName === "string" ? displayName : displayName?.text ?? "",
  );
  if (!placeNorm) {
    return { match: false, reason: "empty_place_name" };
  }
  if (venueNorm === placeNorm) {
    return { match: true, reason: "exact_normalized_name" };
  }
  for (const alias of aliases) {
    const aliasNorm = normalizeVenueName(alias);
    if (aliasNorm && aliasNorm === placeNorm) {
      return { match: true, reason: "places_name_alias" };
    }
  }
  return { match: false, reason: "name_token_mismatch" };
}

/** @returns {string | null} */
export function extractUkPostcode(address) {
  const match = String(address).match(
    /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i,
  );
  if (!match) return null;
  return match[1].replace(/\s+/g, " ").toUpperCase();
}

/**
 * @returns {{ match: boolean; reason: string }}
 */
export function evaluateLocationMatch(row, place) {
  const postcode = extractUkPostcode(row.address);
  const formatted = String(place.formattedAddress ?? "");
  if (postcode) {
    const rowCompact = postcode.replace(/\s+/g, "").toUpperCase();
    const placePostcode = extractUkPostcode(formatted);
    if (placePostcode) {
      const placeCompact = placePostcode.replace(/\s+/g, "").toUpperCase();
      if (rowCompact === placeCompact) {
        return { match: true, reason: `postcode_${postcode}` };
      }
    }
  }
  const lat = place.location?.latitude;
  const lng = place.location?.longitude;
  const rowLat = row.lat ?? row.location?.lat;
  const rowLng = row.lng ?? row.location?.lng;
  if (
    typeof lat === "number" &&
    typeof lng === "number" &&
    typeof rowLat === "number" &&
    typeof rowLng === "number"
  ) {
    const meters = haversineMeters(rowLat, rowLng, lat, lng);
    if (meters <= 150) {
      return { match: true, reason: `within_${Math.round(meters)}m` };
    }
    return { match: false, reason: `distance_${Math.round(meters)}m` };
  }
  return { match: false, reason: "no_postcode_or_coordinates" };
}

function placeDisplayText(place) {
  const dn = place.displayName;
  return typeof dn === "string" ? dn : dn?.text ?? "";
}

/**
 * @param {object} row Famous venue seed row
 * @param {object[]} places Places API `places` array
 */
export function decidePlacesVerification(row, places) {
  const list = Array.isArray(places) ? places : [];
  if (list.length === 0) {
    return {
      outcome: "unverified",
      result: "places_no_result",
      evidence: { matchReason: "no_places_in_response" },
    };
  }

  const confident = [];
  for (const place of list) {
    const name = evaluateNameMatch(
      row.name,
      placeDisplayText(place),
      row.placesNameAliases ?? [],
    );
    const location = evaluateLocationMatch(row, place);
    if (name.match && location.match) {
      confident.push({
        place,
        matchReason: `${name.reason};${location.reason}`,
      });
    }
  }

  if (confident.length === 0) {
    const first = list[0];
    const name = evaluateNameMatch(
      row.name,
      placeDisplayText(first),
      row.placesNameAliases ?? [],
    );
    const location = evaluateLocationMatch(row, first);
    return {
      outcome: "unverified",
      result: "places_no_confident_match",
      evidence: {
        placeId: first.id ?? null,
        matchReason: `name:${name.reason};location:${location.reason}`,
      },
    };
  }

  if (confident.length > 1) {
    const ids = new Set(confident.map((c) => c.place.id));
    if (ids.size > 1) {
      return {
        outcome: "unverified",
        result: "places_ambiguous_match",
        evidence: {
          matchReason: `multiple_confident_places_${confident.length}`,
        },
      };
    }
  }

  const { place, matchReason } = confident[0];
  const evidence = { placeId: place.id ?? null, matchReason };

  const status = place.businessStatus;
  if (status === "OPERATIONAL") {
    return { outcome: "confirmed", result: "places_operational", evidence };
  }
  if (status === "CLOSED_PERMANENTLY") {
    return { outcome: "closed", result: "places_closed_permanently", evidence };
  }
  return {
    outcome: "unverified",
    result:
      status === "CLOSED_TEMPORARILY"
        ? "places_closed_temporarily"
        : "places_non_operational_status",
    evidence,
  };
}

export function placesTextQueryForRow(row) {
  const postcode = extractUkPostcode(row.address);
  const parts = [row.name];
  if (postcode) parts.push(postcode);
  else parts.push(row.borough ?? "London");
  parts.push("London");
  return parts.join(" ");
}
