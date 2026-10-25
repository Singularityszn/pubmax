import "server-only";

import type { ImportSource, PubListNightDraft } from "@/lib/pubListImport";
import { requireSupabaseAdmin } from "@/lib/supabase";

const COLUMNS = "id,venue_ids,source_url,source_platform,source_handle,created_at";

function draft(row: Record<string, unknown>): PubListNightDraft {
  return {
    id: String(row.id), venueIds: row.venue_ids as string[], createdAt: String(row.created_at),
    source: row.source_url ? {
      url: String(row.source_url), platform: row.source_platform as ImportSource["platform"],
      handle: typeof row.source_handle === "string" ? row.source_handle : null,
    } : null,
  };
}

/** API ownership and database RLS both restrict a draft to its signed-in owner. */
export async function savePubListNightDraft(ownerId: string, input: {
  id: string; venueIds: string[]; source: ImportSource | null;
}): Promise<PubListNightDraft> {
  // The composite conflict key prevents one owner from replacing another owner's draft.
  const { data, error } = await requireSupabaseAdmin().from("pub_list_night_drafts").upsert({
    id: input.id, owner_user_id: ownerId, venue_ids: input.venueIds,
    source_url: input.source?.url ?? null, source_platform: input.source?.platform ?? null,
    source_handle: input.source?.handle ?? null,
  }, { onConflict: "owner_user_id,id" }).select(COLUMNS).single();
  if (error || !data) throw new Error("Night draft storage is unavailable.");
  return draft(data);
}

export async function listPubListNightDrafts(ownerId: string, limit = 40): Promise<PubListNightDraft[]> {
  const { data, error } = await requireSupabaseAdmin().from("pub_list_night_drafts")
    .select(COLUMNS).eq("owner_user_id", ownerId).order("created_at", { ascending: false }).limit(limit);
  if (error || !data) throw new Error("Night draft storage is unavailable.");
  return data.map(draft);
}

export async function getPubListNightDraft(ownerId: string, id: string): Promise<PubListNightDraft | null> {
  const { data, error } = await requireSupabaseAdmin().from("pub_list_night_drafts")
    .select(COLUMNS).eq("owner_user_id", ownerId).eq("id", id).maybeSingle();
  if (error) throw new Error("Night draft storage is unavailable.");
  return data ? draft(data) : null;
}
