// Public profile read seam for /u/[handle]. Returns the STORED profile row (or
// null when a handle has dropped no pints yet / Supabase is unconfigured), its
// follower/following counts, and — when a `?viewer=<handle>` is supplied — whether
// that viewer already follows this handle (drives the follow button's initial
// state without a second request).
//
// Store choice is the single seam pattern from app/api/pint-drops/route.ts:
// Supabase when configured, process-memory otherwise. Reads never 503 — a
// missing profile is a first-class "null" result, so the page always renders.

import { isLimited } from "@/lib/pintDrops";
import { normalizeHandle } from "@/lib/profiles";
import { callerUserId } from "@/lib/authServer";
import { decideProfileWrite, gateHandleAction } from "@/lib/profileOwnership";
import {
  profileStore,
  type ProfilePatch,
  type ProfileRecord,
} from "@/lib/profileStore";
import { followStore } from "@/lib/followStore";
import {
  clientIp,
  hashIp,
  isSupabaseConfigured,
  requiresSupabaseStore,
} from "@/lib/supabase";
import { cleanText, isHttpUrl } from "@/lib/textClean";
import { assertServerEnv } from "@/lib/serverEnv";
import { jsonNoStore } from "@/lib/apiResponses";

assertServerEnv();

function stores() {
  return { profiles: profileStore(), follows: followStore() };
}

// Public projection of a profile row: strips the internal ownership key
// (user_id) so it never crosses the wire on the public /u/[handle] read. Only
// the display-facing fields are exposed.
function toPublicProfile(profile: ProfileRecord | null): Omit<ProfileRecord, "userId"> | null {
  if (!profile) return null;
  const { userId: _userId, ...rest } = profile;
  void _userId;
  return rest;
}

// Trust boundary for profile edits — the request body is untrusted. cleanText
// (lib/textClean) strips inline HTML angle brackets + control chars, collapses
// whitespace, and caps length; isHttpUrl validates the avatar link. Both mirror
// the shared trust boundary so every write path agrees.

// Editable field caps. The handle itself is NOT editable here (it is the
// identity key — renaming is a separate, auth-gated operation).
const MAX_DISPLAY_NAME = 60;
const MAX_BIO = 280;
const MAX_HOME_CITY = 60;
const MAX_AVATAR_URL = 400;

// An avatar must be an http(s) URL within the cap, or empty (which clears it).
// Anything else — javascript:, data:, a bare string, an over-long URL — is
// rejected rather than stored, so the header's <Image src> only ever gets a
// real remote image URL. Empty is a *valid* clear (ok:true, url:""); junk is a
// rejection (ok:false) the caller turns into a 400 — so this keeps its own
// discriminated result and delegates only the URL check to the shared isHttpUrl.
function cleanAvatarUrl(value: unknown): { ok: true; url: string } | { ok: false } {
  if (value == null || value === "") return { ok: true, url: "" };
  if (typeof value !== "string") return { ok: false };
  if (value.trim() === "") return { ok: true, url: "" };
  const url = isHttpUrl(value, MAX_AVATAR_URL);
  return url ? { ok: true, url } : { ok: false };
}

// Build a ProfilePatch from an untrusted body. Only keys the caller actually
// sent are included, so an edit form that omits a field never clears it. Empty
// strings are meaningful: they clear an optional field (stored as null).
function buildPatch(
  body: Record<string, unknown>,
): { ok: true; patch: ProfilePatch } | { ok: false; error: string } {
  const patch: ProfilePatch = {};

  if ("displayName" in body) {
    const name = cleanText(body.displayName, MAX_DISPLAY_NAME);
    patch.displayName = name || null;
  }
  if ("bio" in body) {
    const bio = cleanText(body.bio, MAX_BIO);
    patch.bio = bio || null;
  }
  if ("homeCity" in body) {
    const city = cleanText(body.homeCity, MAX_HOME_CITY);
    patch.homeCity = city || null;
  }
  if ("avatarUrl" in body) {
    const avatar = cleanAvatarUrl(body.avatarUrl);
    if (!avatar.ok) {
      return { ok: false, error: "Avatar must be an http(s) image URL (or left blank)." };
    }
    patch.avatarUrl = avatar.url || null;
  }

  return { ok: true, patch };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  const handle = normalizeHandle((await params).handle);
  if (!handle) {
    return jsonNoStore({ error: "Missing handle." }, { status: 400 });
  }

  const { profiles, follows } = stores();
  const viewer = normalizeHandle(new URL(request.url).searchParams.get("viewer") ?? "");

  try {
    const [profile, counts] = await Promise.all([
      profiles.getByHandle(handle),
      follows.counts(handle),
    ]);
    // Only compute follow status for a *different* viewer — a handle never
    // "follows itself", and asking short-circuits to false.
    const viewerFollowing =
      viewer && viewer !== handle ? await follows.isFollowing(viewer, handle) : false;

    return jsonNoStore(
      { profile: toPublicProfile(profile), counts, viewerFollowing },
      { status: 200 },
    );
  } catch {
    // A backend hiccup degrades to the synthesized-profile path on the client —
    // return an empty-but-valid shape rather than an error the page must handle.
    return jsonNoStore(
      { profile: null, counts: { followers: 0, following: 0 }, viewerFollowing: false },
      { status: 200 },
    );
  }
}

// Update the editable fields of a profile ("claim your handle" / edit-profile).
//
// OWNERSHIP (user story 31), enforced HERE at the API seam because writes route
// through the service-role admin client (which bypasses RLS — so RLS alone can't
// gate the app's own writes; see lib/profileOwnership.ts + migration 0009):
//   • We resolve the caller's VERIFIED auth uid from their bearer token
//     (callerUserId → Supabase auth.getUser). No token / invalid token → null
//     (anonymous), never a trusted uid.
//   • decideProfileWrite(rowUserId, callerUserId): an UNLINKED handle stays
//     editable by anyone (the demo/self-asserted-handle stance is preserved); a
//     LINKED handle is editable ONLY by its matching authenticated owner — a
//     non-owner (anonymous OR a different account) gets 403. This is the security
//     win: once claimed, a handle can't be hijacked.
//   • First authenticated touch LINKS the caller onto the handle (shouldLinkUser
//     → store.linkUser) — this is also the account migration (story 32): every
//     drop/save/follow is already handle-keyed, so stamping user_id claims them
//     all with no data copy.
//
// Regardless of auth we still apply the full server-side trust boundary below
// (strip HTML/control chars, cap lengths, validate the avatar URL) and
// rate-limit, so any caller can neither inject markup nor flood the write path.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  const handle = normalizeHandle((await params).handle);
  if (!handle) {
    return jsonNoStore({ error: "Missing handle." }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }

  // Rate-limit per handle + hashed IP so a profile can't be edit-spammed.
  const key = `profile-edit:${handle}:${hashIp(clientIp(request))}`;
  if (await isLimited(handle, key)) {
    return jsonNoStore({ error: "Too many edits, slow down." }, { status: 429 });
  }

  const built = buildPatch(body);
  if (!built.ok) {
    return jsonNoStore({ error: built.error }, { status: 400 });
  }

  // In production we require the durable store — silently editing an in-memory
  // row that vanishes on the next cold start would be a lie about persistence.
  if (requiresSupabaseStore() && !isSupabaseConfigured()) {
    return jsonNoStore({ error: "Profile storage is not configured." }, { status: 503 });
  }

  // OWNERSHIP GATE: linked handle → JWT owner only; unlinked → demo path.
  const gate = await gateHandleAction(request, handle);
  if (!gate.allowed) {
    return jsonNoStore({ error: gate.error }, { status: gate.status });
  }

  try {
    const store = profileStore();
    // Ensure a row exists before patching (a handle that has only claimed, never
    // dropped a pint, may have no row yet). gateHandleAction already linked on
    // first authenticated touch when needed.
    await store.ensure(handle);
    const profile = await store.update(handle, built.patch);
    return jsonNoStore({ profile: toPublicProfile(profile) }, { status: 200 });
  } catch {
    return jsonNoStore({ error: "Profile storage is unavailable." }, { status: 503 });
  }
}

// Soft-delete a profile (clear editable fields). Same ownership gate as PATCH:
// unlinked handles stay deletable by anyone (demo); linked handles require the
// matching authenticated owner. We deliberately do NOT hard-delete the row —
// follows and handle-keyed activity would cascade — see ProfileStore.softDelete.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  const handle = normalizeHandle((await params).handle);
  if (!handle) {
    return jsonNoStore({ error: "Missing handle." }, { status: 400 });
  }

  const key = `profile-delete:${handle}:${hashIp(clientIp(request))}`;
  if (await isLimited(handle, key)) {
    return jsonNoStore({ error: "Too many edits, slow down." }, { status: 429 });
  }

  if (requiresSupabaseStore() && !isSupabaseConfigured()) {
    return jsonNoStore({ error: "Profile storage is not configured." }, { status: 503 });
  }

  const caller = await callerUserId(request);

  try {
    const store = profileStore();
    const existing = await store.getByHandle(handle);
    if (!existing) {
      return jsonNoStore({ error: "Profile not found." }, { status: 404 });
    }

    const decision = decideProfileWrite(existing.userId, caller);
    if (!decision.allowed) {
      return jsonNoStore(
        { error: "This handle belongs to a signed-in account. Sign in as its owner to delete it." },
        { status: decision.status },
      );
    }

    const profile = await store.softDelete(handle);
    return jsonNoStore({ profile: toPublicProfile(profile) }, { status: 200 });
  } catch {
    return jsonNoStore({ error: "Profile storage is unavailable." }, { status: 503 });
  }
}

// Some clients (and form libraries) prefer PUT for a full-resource update. The
// semantics here are identical — a validated, rate-limited field patch — so PUT
// is an alias for PATCH.
export const PUT = PATCH;
