import { slugifyVenueName } from "@/lib/venuePermalinkSlug";

/** Canonical borough code used by the Pint Index and its arrival analytics. */
export function boroughCode(name: string): string {
  return slugifyVenueName(name);
}
