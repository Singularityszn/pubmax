export type VenueAreaSource = {
  locality?: string | null;
  primaryBorough?: string | null;
};

/** Use neighbourhood locality for readers, with borough as honest fallback. */
export function venueAreaLabel(venue: VenueAreaSource): string {
  return venue.locality?.trim() || venue.primaryBorough?.trim() || "London";
}

/** Remove a stray comma-separated "Greater" token from display addresses. */
export function displayVenueAddress(address: string): string {
  return address
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part.toLowerCase() !== "greater")
    .join(", ");
}
