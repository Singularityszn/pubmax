import { describe, expect, it } from "vitest";
import { parseSocialGalleryCreate, parseSocialGalleryEdit } from "@/lib/socialGallerySubmission";

const gallery = [{ mediaId: "11111111-1111-4111-8111-111111111111", altText: "Friends beside the canal" }];
const fields = { kind: "standard", visibility: "friends", commentPolicy: "open", body: "", gallery };

describe("gallery post submissions", () => {
  it("allows a photo-only post while keeping ordinary audience validation", () => {
    expect(parseSocialGalleryCreate(fields)).toMatchObject({ ok: true, payload: { visibility: "friends", gallery } });
    expect(parseSocialGalleryCreate({ ...fields, visibility: "world" })).toMatchObject({ ok: false });
    expect(parseSocialGalleryCreate({ ...fields, kind: "feature_request" })).toMatchObject({ ok: false, code: "FEATURE_REQUEST_BODY_REQUIRED" });
  });

  it("rejects mixed legacy media authority and unknown fields", () => {
    for (const extra of [{ photoAltText: "Other" }, { tagHandles: [] }, { removePhoto: true }, { objectKey: "private.jpg" }]) {
      expect(parseSocialGalleryCreate({ ...fields, ...extra })).toMatchObject({ ok: false });
    }
  });

  it("keeps absent edit fields absent and accepts gallery-only changes", () => {
    expect(parseSocialGalleryEdit({ expectedMutationVersion: 4, gallery })).toEqual({ ok: true, payload: { expectedMutationVersion: 4, gallery } });
    expect(parseSocialGalleryEdit({ expectedMutationVersion: 4, gallery: [], venueId: null })).toEqual({ ok: true, payload: { expectedMutationVersion: 4, gallery: [], venueId: null } });
    expect(parseSocialGalleryEdit({ expectedMutationVersion: -1, gallery })).toMatchObject({ ok: false });
  });
});
