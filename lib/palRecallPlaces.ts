import { LONDON_NIGHT_AREA_SLUGS } from "@/lib/nightAreaSlugs";

export const PAL_RECALL_PLACES = [
  ...LONDON_NIGHT_AREA_SLUGS.map((slug) => slug.replaceAll("-", " ")),
  "Piccadilly & Soho", "Piccadilly", "Soho",
  "Bermondsey & London Bridge", "Bermondsey", "London Bridge",
  "King's Cross", "Waterloo", "Bank", "Covent Garden", "Farringdon", "Mayfair",
] as const;
