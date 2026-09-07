import { parseSocialGallery, type SocialGalleryPhoto } from "@/lib/socialGallery";
import { parseSocialCreateSubmission, parseSocialEditSubmission } from "@/lib/socialPostSubmission";
import type { SocialPostFields } from "@/lib/socialPosts";

export type SocialGalleryFields = Omit<SocialPostFields, "photo" | "photos">;
export type SocialGalleryCreate = SocialGalleryFields & { gallery: SocialGalleryPhoto[] };
export type SocialGalleryEdit = Partial<SocialGalleryFields> & { expectedMutationVersion: number; gallery: SocialGalleryPhoto[] };

type InvalidGallery = { ok: false; error: string; code: string };
const invalid = (): InvalidGallery => ({ ok: false, code: "INVALID_GALLERY", error: "Choose up to 10 photos and describe each photo." });

export function hasSocialGallery(value: unknown): value is Record<string, unknown> & { gallery: unknown } {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "gallery"));
}

function galleryInput(input: unknown, allowEmpty: boolean) {
  if (!hasSocialGallery(input) || ["photoAltText", "tagHandles", "removePhoto", "photo", "photos"].some(key => key in input)) return null;
  const gallery = parseSocialGallery(input.gallery, allowEmpty);
  if (!gallery) return null;
  const ordinary = Object.fromEntries(Object.entries(input).filter(([key]) => key !== "gallery"));
  return { gallery, ordinary };
}

export function parseSocialGalleryCreate(input: unknown): { ok: true; payload: SocialGalleryCreate } | InvalidGallery {
  const parsed = galleryInput(input, false);
  if (!parsed) return invalid();
  const result = parseSocialCreateSubmission({ ...parsed.ordinary, photoAltText: parsed.gallery[0].altText }, true, "image/jpeg");
  if (!result.ok) return result;
  return { ok: true, payload: { ...result.post, gallery: parsed.gallery } };
}

export function parseSocialGalleryEdit(input: unknown): { ok: true; payload: SocialGalleryEdit } | InvalidGallery {
  const parsed = galleryInput(input, true);
  if (!parsed) return invalid();
  const attached = parsed.gallery.length > 0;
  const result = parseSocialEditSubmission({
    ...parsed.ordinary,
    ...(attached ? { photoAltText: parsed.gallery[0].altText } : { removePhoto: true }),
  }, attached, "image/jpeg");
  if (!result.ok) return result;
  return { ok: true, payload: { ...result.changes, expectedMutationVersion: result.expectedMutationVersion, gallery: parsed.gallery } };
}
