const londonDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });

/** Return a comparable pint price only when its own evidence is complete. */
export function comparablePint({ cheapestPrice, priceSource, priceObservedAt, anchorLabel, measure } = {}) {
  if (typeof cheapestPrice !== "number" || !Number.isFinite(cheapestPrice) || cheapestPrice <= 0) return null;
  if (typeof priceSource !== "string" || !priceSource.trim()) return null;
  if (anchorLabel != null && (typeof anchorLabel !== "string" || anchorLabel.trim())) return null;
  if (measure != null && measure !== "pint") return null;
  return pintObservationTime(priceObservedAt) === null ? null : cheapestPrice;
}

export function pintObservationTime(priceObservedAt) {
  if (typeof priceObservedAt !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:T.*)?$/.exec(priceObservedAt);
  if (!match) return null;
  const day = match[1];
  const stamp = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== day) return null;
  const today = londonDay.format(new Date());
  if (day > today) return null;
  const instant = Date.parse(priceObservedAt);
  if (!Number.isFinite(instant) || (priceObservedAt.length > 10 && instant > Date.now())) return null;
  return instant;
}
