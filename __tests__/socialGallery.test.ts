import { describe, expect, it } from "vitest";
import { galleryPhotosFromRow, parseSocialGallery, socialPostPhotos } from "@/lib/socialGallery";

const first = { mediaId: "11111111-1111-4111-8111-111111111111", altText: "The band on stage" };
const second = { mediaId: "22222222-2222-4222-8222-222222222222", altText: "Friends beside the canal" };

describe("ordered Social galleries", () => {
  it("preserves photo order and requires a description for each photo", () => {
    expect(parseSocialGallery([second, first])).toEqual([second, first]);
    expect(parseSocialGallery([first, { ...second, altText: " " }])).toBeNull();
    expect(parseSocialGallery([first, { ...second, altText: "x".repeat(301) }])).toBeNull();
  });

  it("refuses client storage authority, duplicate IDs, and oversized galleries", () => {
    expect(parseSocialGallery([{ ...first, objectKey: "someone-else/photo.jpg" }])).toBeNull();
    expect(parseSocialGallery([first, first])).toBeNull();
    expect(parseSocialGallery(Array.from({ length: 11 }, () => first))).toBeNull();
    expect(parseSocialGallery([{ ...first, mediaId: "not-an-id" }])).toBeNull();
  });

  it("accepts removal only in an edit and distinguishes legacy media from an empty gallery", () => {
    expect(parseSocialGallery([])).toBeNull();
    expect(parseSocialGallery([], true)).toEqual([]);
    expect(socialPostPhotos({ photo: first })).toEqual([first]);
    expect(socialPostPhotos({ photo: first, photos: [] })).toEqual([]);
    expect(socialPostPhotos({ photo: first, photos: [second, first] })).toEqual([second, first]);
  });

  it("refuses malformed stored manifests instead of showing only the cover", () => {
    expect(galleryPhotosFromRow(null)).toBeUndefined();
    expect(galleryPhotosFromRow([first])).toEqual([{ ...first, kind: "photo", contentType: "image/jpeg" }]);
    expect(() => galleryPhotosFromRow([{ ...first, altText: "" }])).toThrow("Social gallery data is not valid.");
  });
});
