import { slugifyVenueName } from "@/lib/venueNameSlug";

export function boroughCode(name: string): string {
  return slugifyVenueName(name);
}
