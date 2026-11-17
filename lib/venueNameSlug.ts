import { kebabSlug } from "@/lib/textSlug";

export function slugifyVenueName(name: string): string {
  return kebabSlug(name.replace(/&/g, " and "));
}
