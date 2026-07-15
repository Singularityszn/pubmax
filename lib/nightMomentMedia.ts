import { randomUUID } from "node:crypto";

import { deletePhotos, uploadPhoto } from "@/lib/pintDropsStore";
import { isSupabaseConfigured, requireSupabaseAdmin, STORAGE_BUCKET } from "@/lib/supabase";

export async function uploadNightMomentPhoto(
  ownerId: string,
  memoryId: string,
  file: File,
): Promise<string> {
  if (!isSupabaseConfigured()) {
    throw new Error("Photo storage is unavailable. Your draft is still on this device.");
  }
  return uploadPhoto(
    "venue",
    `night-moments/${ownerId}/${memoryId}`,
    randomUUID(),
    file,
  );
}

export async function removeNightMomentPhoto(key: string): Promise<void> {
  await deletePhotos([key]);
}

export async function signedNightMomentPhotoUrl(key: string | null): Promise<string | null> {
  if (!key || !isSupabaseConfigured()) return null;
  const { data, error } = await requireSupabaseAdmin()
    .storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(key, 60 * 60);
  return error ? null : data.signedUrl;
}
