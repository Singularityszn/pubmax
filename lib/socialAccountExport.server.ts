import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ACCOUNT_EXPORT_LANE_CAP, type AccountExportSocialMedia, type AccountExportSocialPost } from "@/lib/accountExport";
import { socialPostFromRow } from "@/lib/socialPostStore";
import { exportSocialPost } from "@/lib/socialAccountExport";
import { requireSupabaseAdmin } from "@/lib/supabase";

const POST_COLUMNS = "id,author_profile_id,author_handle,kind,visibility,status,body,area_slug,venue_id,hashtags,comment_policy,photo_media_id,photo_alt_text,gallery_photos,moderation_state,feature_status,feature_staff_response,revision,mutation_version,edited_at,moderated_at,created_at,updated_at,legacy_media:social_post_media!social_posts_photo_media_fk(content_type,owner_profile_id),social_post_gallery(media_id,position,alt_text,media:social_post_media(owner_profile_id,content_type))";
const MEDIA_COLUMNS = "id,owner_profile_id,object_key,content_type,width,height,byte_size,attachment_state,created_at,retention_expires_at";
const UPLOAD_COLUMNS = "media_id,owner_profile_id,object_key,content_type,width,height,byte_size,state,created_at,uploaded_at";

type Row = Record<string, unknown>;
function row(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Social export row.");
  return value as Row;
}

// Keyset pages survive deleted reservations and preserve the extra row used to detect truncation.
async function ownedRows(client: SupabaseClient, table: string, columns: string, ownerColumn: string, owner: string, id: string): Promise<Row[]> {
  const rows: Row[] = [];
  const limit = ACCOUNT_EXPORT_LANE_CAP + 1;
  while (rows.length < limit) {
    const count = Math.min(500, limit - rows.length);
    let query = client.from(table).select(columns).eq(ownerColumn, owner)
      .order("created_at", { ascending: false }).order(id, { ascending: false });
    const last = rows.at(-1);
    if (last) {
      query = query.or(`created_at.lt.${last.created_at},and(created_at.eq.${last.created_at},${id}.lt.${last[id]})`);
    }
    const { data, error } = await query.range(0, count - 1);
    if (error || !Array.isArray(data)) throw new Error("Social export read unavailable.");
    const page = data.map(row);
    if (page.some(item => item[ownerColumn] !== owner)) throw new Error("Social export owner mismatch.");
    rows.push(...page);
    if (page.length < count) break;
  }
  return rows;
}

export async function readSocialPostsForExport(owner: string, client = requireSupabaseAdmin()): Promise<AccountExportSocialPost[]> {
  const posts = await ownedRows(client, "social_posts", POST_COLUMNS, "author_profile_id", owner, "id");
  return posts.map(post => {
    if (!Array.isArray(post.social_post_gallery)) throw new Error("Social gallery export unavailable.");
    const gallery = post.social_post_gallery.map(row).sort((a, b) => Number(a.position) - Number(b.position));
    for (const [index, item] of gallery.entries()) {
      if (item.position !== index + 1 || row(item.media).owner_profile_id !== owner || row(item.media).content_type !== "image/jpeg") {
        throw new Error("Social gallery ownership or order invalid.");
      }
    }
    if (post.gallery_photos === null && gallery.length > 0) throw new Error("Social gallery export incomplete.");
    if (post.gallery_photos !== null && (!Array.isArray(post.gallery_photos) || gallery.length !== post.gallery_photos.length)) {
      throw new Error("Social gallery export incomplete.");
    }
    const legacy = post.legacy_media == null ? null : row(post.legacy_media);
    if (post.photo_media_id && !legacy) throw new Error("Social media export unavailable.");
    if (legacy && legacy.owner_profile_id !== owner) throw new Error("Social media owner mismatch.");
    return exportSocialPost(socialPostFromRow({ ...post,
      photo_content_type: legacy?.content_type,
      gallery_photos: post.gallery_photos === null ? null : gallery.map(item => ({ mediaId: item.media_id, altText: item.alt_text })),
    }));
  });
}

export async function readSocialMediaForExport(owner: string, client = requireSupabaseAdmin()): Promise<AccountExportSocialMedia[]> {
  // Attachment moves a reservation into media. Read the source first so that move cannot disappear between reads.
  const uploads = await ownedRows(client, "social_post_media_uploads", UPLOAD_COLUMNS, "owner_profile_id", owner, "media_id");
  const media = await ownedRows(client, "social_post_media", MEDIA_COLUMNS, "owner_profile_id", owner, "id");
  const project = (item: Row, upload: boolean): AccountExportSocialMedia => ({
    mediaId: String(upload ? item.media_id : item.id), objectKey: String(item.object_key),
    contentType: String(item.content_type),
    width: Number(item.width), height: Number(item.height), byteSize: Number(item.byte_size),
    state: String(upload ? item.state : item.attachment_state), createdAt: String(item.created_at),
    uploadedAt: upload && typeof item.uploaded_at === "string" ? item.uploaded_at : null,
    retentionExpiresAt: typeof item.retention_expires_at === "string" ? item.retention_expires_at : null,
  });
  const byId = new Map(uploads.map(item => { const value = project(item, true); return [value.mediaId, value]; }));
  for (const item of media) { const value = project(item, false); byId.set(value.mediaId, value); }
  const items = [...byId.values()];
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.mediaId.localeCompare(a.mediaId))
    .slice(0, ACCOUNT_EXPORT_LANE_CAP + 1);
}
