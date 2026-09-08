import type { SocialPostPhoto } from "@/lib/socialPosts";

export const SOCIAL_GALLERY_MAX_PHOTOS = 10;
export const SOCIAL_GALLERY_UPLOAD_LIFETIME_MS = 24 * 60 * 60 * 1_000;

export type SocialGalleryPhoto = { mediaId: string; altText: string };

const MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseSocialGallery(value: unknown, allowEmpty = false): SocialGalleryPhoto[] | null {
  if (!Array.isArray(value) || value.length > SOCIAL_GALLERY_MAX_PHOTOS || (!allowEmpty && !value.length)) return null;
  const seen = new Set<string>();
  const photos: SocialGalleryPhoto[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    if (Object.keys(item).some(key => key !== "mediaId" && key !== "altText")) return null;
    const { mediaId, altText } = item as Record<string, unknown>;
    if (typeof mediaId !== "string" || !MEDIA_ID.test(mediaId) || typeof altText !== "string" || altText.length > 300) return null;
    const id = mediaId.toLowerCase();
    const description = altText.replace(/[<>]/g, "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    if (!description || seen.has(id)) return null;
    seen.add(id);
    photos.push({ mediaId: id, altText: description });
  }
  return photos;
}

export function socialPostPhotos(post: { photo: SocialPostPhoto | null; photos?: readonly SocialPostPhoto[] }): readonly SocialPostPhoto[] {
  return post.photos ?? (post.photo ? [post.photo] : []);
}

export function galleryPhotosFromRow(value: unknown): SocialPostPhoto[] | undefined {
  if (value == null) return undefined;
  const photos = parseSocialGallery(value, true);
  if (!photos) throw new Error("Social gallery data is not valid.");
  return photos.map(photo => ({ ...photo, kind: "photo", contentType: "image/jpeg" }));
}
