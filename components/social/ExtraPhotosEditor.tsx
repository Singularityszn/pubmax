"use client";

import { useEffect, useId, useState } from "react";

import { authedActionFetch } from "@/lib/authedFetch";
import { discardBody } from "@/lib/responseBody";
import { SOCIAL_POST_EXTRA_SLOTS, SOCIAL_POST_MAX_PHOTOS, type SocialPostExtraPhoto } from "@/lib/socialPostPhotos";

export type ExtraPhotoDraft = { key: string; file: File; altText: string };

const PHOTO_TYPES = "image/jpeg,image/png,image/webp";
/** Under the serverless body ceiling with room for the form around it. */
const UPLOAD_TARGET_BYTES = 3.5 * 1024 * 1024;
const UPLOAD_LONG_EDGE = 2000;

function draftKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `photo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * A large phone photo is redrawn smaller before it leaves the browser, so one
 * photo a request stays under the serverless body limit. The server still
 * normalises every photo to the same 1200px JPEG as the first.
 */
async function shrinkForUpload(file: File): Promise<Blob> {
  if (file.size <= UPLOAD_TARGET_BYTES || typeof createImageBitmap === "undefined") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, UPLOAD_LONG_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
    return blob ?? file;
  } catch {
    return file;
  }
}

/**
 * Adds photos 2 to 4 to a post that was just created, one request each.
 * Answers the photos that went up and how many did not, so the post is never
 * lost to a photo that failed.
 */
export async function uploadExtraPhotos(
  postId: string,
  drafts: readonly ExtraPhotoDraft[],
): Promise<{ uploaded: SocialPostExtraPhoto[]; failed: number }> {
  const uploaded: SocialPostExtraPhoto[] = [];
  let failed = 0;
  for (const [index, draft] of drafts.slice(0, SOCIAL_POST_EXTRA_SLOTS.length).entries()) {
    try {
      const form = new FormData();
      const body = await shrinkForUpload(draft.file);
      form.set("photo", body instanceof File ? body : new File([body], "photo.jpg", { type: "image/jpeg" }));
      form.set("altText", draft.altText.trim());
      form.set("slot", String(SOCIAL_POST_EXTRA_SLOTS[index]));
      const response = await authedActionFetch(`/api/social/posts/${postId}/photos`, {
        method: "POST",
        credentials: "same-origin",
        body: form,
      }, { requiresIdentity: true });
      if (!response.ok) {
        discardBody(response);
        failed += 1;
        continue;
      }
      const result = (await response.json()) as { photo?: SocialPostExtraPhoto };
      if (result.photo) uploaded.push(result.photo);
    } catch {
      failed += 1;
    }
  }
  return { uploaded, failed };
}

function Preview({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const next = URL.createObjectURL(file);
    void Promise.resolve().then(() => setUrl(next));
    return () => URL.revokeObjectURL(next);
  }, [file]);
  // eslint-disable-next-line @next/next/no-img-element -- local object URL preview.
  return url ? <img src={url} alt="" /> : null;
}

/** Up to three more photos once the first is picked, each with its own description. */
export default function ExtraPhotosEditor({
  drafts,
  onChange,
}: {
  drafts: ExtraPhotoDraft[];
  onChange: (drafts: ExtraPhotoDraft[]) => void;
}) {
  const room = SOCIAL_POST_MAX_PHOTOS - 1 - drafts.length;
  const hintId = useId();
  return (
    <div className="socialExtraPhotos">
      {drafts.length > 0 ? (
        <ol className="socialExtraPhotos__list">
          {drafts.map((draft, index) => (
            <li key={draft.key}>
              <Preview file={draft.file} />
              <label>
                Photo {index + 2} description
                <input
                  required
                  maxLength={300}
                  value={draft.altText}
                  onChange={(event) => onChange(drafts.map((item) => item.key === draft.key ? { ...item, altText: event.currentTarget.value } : item))}
                />
              </label>
              <button type="button" className="socialRemovePhoto" onClick={() => onChange(drafts.filter((item) => item.key !== draft.key))}>
                Remove photo {index + 2}
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      {room > 0 ? (
        <label className="socialPhotoPicker">
          <span className="socialPhotoCue" aria-hidden="true">+</span>
          <span>{drafts.length === 0 ? "Add more photos" : "Add another photo"}</span>
          <input
            aria-label="Add more photos"
            aria-describedby={hintId}
            type="file"
            multiple
            accept={PHOTO_TYPES}
            onChange={(event) => {
              const picked = [...(event.currentTarget.files ?? [])].slice(0, room);
              event.currentTarget.value = "";
              onChange([...drafts, ...picked.map((file) => ({ key: draftKey(), file, altText: "" }))]);
            }}
          />
        </label>
      ) : null}
      <p id={hintId} className="socialVideoHint">Up to four photos. Each is checked before your lot sees it.</p>
    </div>
  );
}
