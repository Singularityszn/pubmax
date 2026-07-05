import { listAllVisiblePintDrops } from "@/lib/pintDrops";
import { getSupabaseAdmin, isSupabaseConfigured, STORAGE_BUCKET } from "@/lib/supabase";
import { resolveVenue, venueMapUrl } from "@/lib/venueIndex";

// Standalone Pint Drop permalink lookup (PRD §8). ONE public read: turn a drop
// id into a leak-proof, share-ready DTO for /p/[id] and its OG card. Server-only
// — it reads Supabase / the venue index with node primitives and must never be
// imported into a client bundle.
//
// Leak-proofness is enforced by COLUMN SELECTION, not by post-filtering: the
// Supabase read names ONLY public columns, so a hidden/reported drop can never
// expose its photo keys or any moderation field even if the row is fetched.
// (`.eq("status","visible")` then guarantees a hidden row returns null at all.)

// The exact, public-only column list. NEVER add report_*/moderator_*/moderated_*
// here — a hidden drop's photo keys and moderation trail must not leave the DB.
const PUBLIC_COLUMNS =
  "id,venue_id,handle,drink,price_gbp,passed_down_note,era,provenance,created_at,vibe_tags,pint_photo_key,venue_photo_key";

// The one shape the permalink page + OG card consume. Photo keys are already
// resolved to public URLs; the raw venue id is enriched to a real pub name and a
// map link so no surface ever renders "venue-1ufn31x".
export type PublicDrop = {
  id: string;
  venueId: string;
  venueName: string;
  venueMapUrl: string;
  handle: string;
  drink: string;
  priceGbp: number | null;
  note: string;
  era: string;
  provenance: string;
  createdAt: string;
  vibeTags: string[];
  pintPhotoUrl: string | null;
  venuePhotoUrl: string | null;
};

// Shape of the public columns we select from Supabase. Loose on purpose — every
// field is re-normalised below, never trusted as-is.
type VisibleRow = {
  id: string;
  venue_id: string;
  handle: string;
  drink: string | null;
  price_gbp: number | string | null;
  passed_down_note: string | null;
  era: string | null;
  provenance: string | null;
  created_at: string;
  vibe_tags: unknown;
  pint_photo_key: string | null;
  venue_photo_key: string | null;
};

function toPrice(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((t): t is string => typeof t === "string");
}

// Build a public Storage URL from a key. getPublicUrl is a pure string build (no
// network), and only ever runs for a row we already know is visible.
function publicUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  const admin = getSupabaseAdmin();
  if (!admin) return null;
  return admin.storage.from(STORAGE_BUCKET).getPublicUrl(key).data.publicUrl;
}

// Enrich a bare (venueId, keys) drop into the shared DTO: resolve the venue name
// + map link, coerce photo URLs. Split out so both backends share one exit path.
async function enrich(fields: {
  id: string;
  venueId: string;
  handle: string;
  drink: string;
  priceGbp: number | null;
  note: string;
  era: string;
  provenance: string;
  createdAt: string;
  vibeTags: string[];
  pintPhotoUrl: string | null;
  venuePhotoUrl: string | null;
}): Promise<PublicDrop> {
  const venue = await resolveVenue(fields.venueId);
  return {
    ...fields,
    venueName: venue?.name ?? "A London pub",
    venueMapUrl: venueMapUrl(fields.venueId),
  };
}

/**
 * Resolve a single public Pint Drop by id, or null.
 *
 * NEVER throws: any Supabase/venue-index failure resolves to null so the
 * permalink degrades to its friendly empty state rather than 500-ing. A hidden,
 * reported, or unknown id resolves to null too — the Supabase read is gated on
 * `status = "visible"` and the memory fallback filters visible-only.
 */
export async function getPintDropById(id: string): Promise<PublicDrop | null> {
  const dropId = typeof id === "string" ? id.trim() : "";
  if (!dropId) return null;

  // Supabase path — leak-proof by column selection.
  if (isSupabaseConfigured()) {
    try {
      const admin = getSupabaseAdmin();
      if (admin) {
        const { data, error } = await admin
          .from("visit_reports")
          .select(PUBLIC_COLUMNS)
          .eq("id", dropId)
          .eq("status", "visible")
          .maybeSingle();
        if (!error && data) {
          const row = data as unknown as VisibleRow;
          return await enrich({
            id: String(row.id),
            venueId: String(row.venue_id),
            handle: String(row.handle ?? ""),
            drink: String(row.drink ?? ""),
            priceGbp: toPrice(row.price_gbp),
            note: String(row.passed_down_note ?? ""),
            era: String(row.era ?? ""),
            provenance: String(row.provenance ?? "anecdote"),
            createdAt: String(row.created_at ?? ""),
            vibeTags: toTags(row.vibe_tags),
            pintPhotoUrl: publicUrl(row.pint_photo_key),
            venuePhotoUrl: publicUrl(row.venue_photo_key),
          });
        }
        // No row (unknown/hidden) or a query error → fall through to memory so a
        // demo-seeded drop id still resolves; if it isn't there either, null.
      }
    } catch {
      // Swallow — degrade to the memory fallback, never surface a 500.
    }
  }

  // Memory / demo fallback: visible-only listing, find by id.
  try {
    const hit = listAllVisiblePintDrops().find((d) => d.id === dropId);
    if (!hit) return null;
    return await enrich({
      id: hit.id,
      venueId: hit.venueId,
      handle: hit.handle,
      drink: hit.drink,
      priceGbp: hit.priceGbp,
      note: hit.passedDownNote,
      era: hit.era,
      provenance: hit.provenance,
      createdAt: hit.createdAt,
      vibeTags: hit.vibeTags ? [...hit.vibeTags] : [],
      // The in-memory store has no Storage, so no photos.
      pintPhotoUrl: null,
      venuePhotoUrl: null,
    });
  } catch {
    return null;
  }
}
