import { randomUUID } from "node:crypto";
import { cleanPalDraft, type MasteryEvent, type MasteryEventKind, type PubPal, type PubPalMemory, type PubPalMemoryKind } from "@/lib/pubPal";
import { cleanText } from "@/lib/textClean";
import { isSupabaseConfigured, requireSupabaseAdmin } from "@/lib/supabase";

const pals = new Map<string, PubPal>();
const memories = new Map<string, PubPalMemory[]>();
const mastery = new Map<string, MasteryEvent[]>();
const MASTERY_POINTS: Record<MasteryEventKind, number> = { plan_completed: 25, venue_discovered: 5, pint_drop_verified: 15, heritage_read: 3, crew_coordinated: 12, night_captured: 20 };

function palFromRow(row: Record<string, unknown>): PubPal {
  return { id: String(row.id), ownerId: String(row.owner_id), name: String(row.name), adultAttestedAt: String(row.adult_attested_at), appearance: row.appearance as PubPal["appearance"], personality: row.personality as PubPal["personality"], voice: row.voice as PubPal["voice"], muted: Boolean(row.muted), hidden: Boolean(row.hidden), masteryPoints: Number(row.mastery_points ?? 0), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

export async function getPubPal(ownerId: string): Promise<PubPal | null> {
  if (!isSupabaseConfigured()) return pals.get(ownerId) ?? null;
  const { data, error } = await requireSupabaseAdmin().from("pub_pals").select("*").eq("owner_id", ownerId).maybeSingle();
  return error || !data ? null : palFromRow(data as Record<string, unknown>);
}

export async function createPubPal(ownerId: string, raw: unknown): Promise<PubPal | null> {
  const draft = cleanPalDraft(raw); if (!draft) return null;
  const existing = await getPubPal(ownerId); if (existing) return existing;
  const now = new Date().toISOString();
  const pal: PubPal = { id: randomUUID(), ownerId, name: draft.name, adultAttestedAt: now, appearance: draft.appearance, personality: draft.personality, voice: draft.voice, muted: false, hidden: false, masteryPoints: 0, createdAt: now, updatedAt: now };
  if (!isSupabaseConfigured()) { pals.set(ownerId, pal); return pal; }
  const { data, error } = await requireSupabaseAdmin().from("pub_pals").insert({ id: pal.id, owner_id: ownerId, name: pal.name, adult_attested_at: now, appearance: pal.appearance, personality: pal.personality, voice: pal.voice, muted: false, hidden: false }).select("*").single();
  return error || !data ? null : palFromRow(data as Record<string, unknown>);
}

export async function updatePubPal(ownerId: string, raw: unknown): Promise<PubPal | null> {
  const existing = await getPubPal(ownerId); if (!existing || !raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const next: PubPal = { ...existing, muted: typeof input.muted === "boolean" ? input.muted : existing.muted, hidden: typeof input.hidden === "boolean" ? input.hidden : existing.hidden, updatedAt: new Date().toISOString() };
  if (!isSupabaseConfigured()) { pals.set(ownerId, next); return next; }
  const { data, error } = await requireSupabaseAdmin().from("pub_pals").update({ muted: next.muted, hidden: next.hidden, updated_at: next.updatedAt }).eq("owner_id", ownerId).select("*").single();
  return error || !data ? null : palFromRow(data as Record<string, unknown>);
}

export async function deletePubPal(ownerId: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return pals.delete(ownerId);
  const { error } = await requireSupabaseAdmin().from("pub_pals").delete().eq("owner_id", ownerId); return !error;
}

export async function listPalMemories(ownerId: string): Promise<PubPalMemory[]> {
  const pal = await getPubPal(ownerId); if (!pal) return [];
  if (!isSupabaseConfigured()) return memories.get(pal.id) ?? [];
  const { data } = await requireSupabaseAdmin().from("pub_pal_memories").select("*").eq("pal_id", pal.id).order("created_at", { ascending: false });
  return (data ?? []).map(row => ({ id: String(row.id), palId: String(row.pal_id), kind: row.kind as PubPalMemoryKind, value: String(row.value), provenance: row.provenance as PubPalMemory["provenance"], createdAt: String(row.created_at) }));
}

export async function confirmPalMemory(ownerId: string, raw: unknown): Promise<PubPalMemory | null> {
  const pal = await getPubPal(ownerId); if (!pal || !raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>; const value = cleanText(input.value, 500); const allowed: PubPalMemoryKind[] = ["venue_preference", "atmosphere_preference", "accessibility_preference", "transport_preference", "drink_preference", "night_outcome", "correction"];
  const kind = typeof input.kind === "string" && allowed.includes(input.kind as PubPalMemoryKind) ? input.kind as PubPalMemoryKind : null; if (!kind || !value) return null;
  const memory: PubPalMemory = { id: randomUUID(), palId: pal.id, kind, value, provenance: kind === "correction" ? "user_correction" : "user_confirmed", createdAt: new Date().toISOString() };
  if (!isSupabaseConfigured()) { memories.set(pal.id, [memory, ...(memories.get(pal.id) ?? [])]); return memory; }
  const { error } = await requireSupabaseAdmin().from("pub_pal_memories").insert({ id: memory.id, pal_id: pal.id, kind, value, provenance: memory.provenance, created_at: memory.createdAt }); return error ? null : memory;
}

export async function addMasteryEvent(ownerId: string, raw: unknown): Promise<MasteryEvent | null> {
  const pal = await getPubPal(ownerId); if (!pal || !raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>; const kinds = Object.keys(MASTERY_POINTS) as MasteryEventKind[]; const kind = typeof input.kind === "string" && kinds.includes(input.kind as MasteryEventKind) ? input.kind as MasteryEventKind : null; const sourceId = cleanText(input.sourceId, 120); if (!kind || !sourceId) return null;
  const current = mastery.get(pal.id) ?? []; const existing = current.find(event => event.kind === kind && event.sourceId === sourceId); if (existing) return existing;
  const event: MasteryEvent = { id: randomUUID(), palId: pal.id, kind, sourceId, points: MASTERY_POINTS[kind], createdAt: new Date().toISOString() };
  if (!isSupabaseConfigured()) { mastery.set(pal.id, [event, ...current]); pals.set(ownerId, { ...pal, masteryPoints: pal.masteryPoints + event.points, updatedAt: event.createdAt }); return event; }
  const admin = requireSupabaseAdmin(); const { data, error } = await admin.from("pub_pal_mastery_events").upsert({ id: event.id, pal_id: pal.id, kind, source_id: sourceId, points: event.points, created_at: event.createdAt }, { onConflict: "pal_id,kind,source_id", ignoreDuplicates: true }).select("*").maybeSingle();
  if (error) return null; if (data) await admin.from("pub_pals").update({ mastery_points: pal.masteryPoints + event.points, updated_at: event.createdAt }).eq("id", pal.id); return data ? event : null;
}
