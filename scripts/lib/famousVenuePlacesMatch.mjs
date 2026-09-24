/**
 * Google Places (New) Text Search match rules for famous-venue re-verification.
 */

const NAME_STOP_WORDS = new Set([
  "the",
  "at",
  "and",
  "bar",
  "pub",
  "london",
  "restaurant",
  "soho",
  "covent",
  "garden",
]);

export function normalizeVenueName(name) {
  return String(name)
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function venueNameTokens(name) {
  return normalizeVenueName(name)
    .split(" ")
    .filter((t) => t.length > 1 && !NAME_STOP_WORDS.has(t));
}

/**
 * @returns {{ match: boolean; reason: string }}
 */
export function evaluateNameMatch(venueName, displayName) {
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
  const shorter = venueNorm.length <= placeNorm.length ? venueNorm : placeNorm;
  const longer = shorter === venueNorm ? placeNorm : venueNorm;
  if (shorter.length >= 6 && longer.includes(shorter)) {
    return { match: true, reason: "normalized_substring" };
  }
  const venueTokens = new Set(venueNameTokens(venueName));
  const placeTokens = new Set(venueNameTokens(placeNorm));
  let shared = 0;
  for (const token of venueTokens) {
    if (placeTokens.has(token)) shared += 1;
  }
  if (shared >= 2) {
    return { match: true, reason: `shared_name_tokens_${shared}` };
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

export function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const r = 6_371_000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

/**
 * @returns {{ match: boolean; reason: string }}
 */
export function evaluateLocationMatch(row, place) {
  const postcode = extractUkPostcode(row.address);
  const formatted = String(place.formattedAddress ?? "");
  if (postcode) {
    const compact = postcode.replace(/\s+/g, "");
    const formattedCompact = formatted.toUpperCase().replace(/\s+/g, "");
    if (formattedCompact.includes(compact)) {
      return { match: true, reason: `postcode_${postcode}` };
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
    const name = evaluateNameMatch(row.name, placeDisplayText(place));
    const location = evaluateLocationMatch(row, place);
    if (name.match && location.match) {
      confident.push({
        place,
        matchReason: `${name.reason};${location.reason}`,
        matchedName: placeDisplayText(place),
      });
    }
  }

  if (confident.length === 0) {
    const first = list[0];
    const name = evaluateNameMatch(row.name, placeDisplayText(first));
    const location = evaluateLocationMatch(row, first);
    return {
      outcome: "unverified",
      result: "places_no_confident_match",
      evidence: {
        placeId: first.id ?? null,
        matchedName: placeDisplayText(first),
        formattedAddress: first.formattedAddress ?? null,
        businessStatus: first.businessStatus ?? null,
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
          candidates: confident.map((c) => ({
            placeId: c.place.id,
            matchedName: c.matchedName,
            businessStatus: c.place.businessStatus,
          })),
        },
      };
    }
  }

  const { place, matchReason, matchedName } = confident[0];
  const evidence = {
    placeId: place.id ?? null,
    matchedName,
    formattedAddress: place.formattedAddress ?? null,
    businessStatus: place.businessStatus ?? null,
    matchReason,
  };

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
