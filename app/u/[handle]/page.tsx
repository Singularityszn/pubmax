"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";

import FollowButton from "@/components/profile/FollowButton";
import PintPassport from "@/components/profile/PintPassport";
import ProfileEditor from "@/components/profile/ProfileEditor";
import ProfileHeader from "@/components/profile/ProfileHeader";
import SavedPubList from "@/components/profile/SavedPubList";
import SiteNav from "@/components/nav/SiteNav";
import { VENUE_FALLBACK_LABEL } from "@/lib/feed";
import type { FollowCounts } from "@/lib/followStore";
import { buildPassport } from "@/lib/passport";
import {
  deriveProfileFromDrops,
  normalizeHandle,
  profileStats,
  type Profile,
  type ProfileDrop,
} from "@/lib/profiles";
import type { ProfileRecord } from "@/lib/profileStore";
import {
  fetchFollowedListsForHandle,
  fetchSavedForHandle,
  groupDTOsByList,
  savedByList,
  type FollowedSavedListDTO,
  type ListType,
  type SavedPub,
  type SavedPubDTO,
} from "@/lib/savedPubs";

import "./profile.css";

// Public profile route /u/[handle]. Client/dynamic on purpose: no
// generateStaticParams, so the build never pre-renders every handle. It fetches
// the public Pint Drops feed, filters to this handle, synthesizes a demo
// profile, and renders the header, the handle's recent drops (photo-first), and
// their saved pubs (from localStorage). It NEVER crashes: a missing handle, a
// failed fetch, or an empty result all resolve to a friendly state.

// The public drop DTO — kept loose; only the fields this page reads are named.
type PublicDrop = ProfileDrop & {
  venueId: string;
  // Enriched server-side by /api/pint-drops (withVenueNames): the human pub name
  // + a "/map?sel=…" url. Optional here because the local PublicDrop shape is
  // kept loose, but the API always sets both (name falls back to "A London pub").
  venueName?: string;
  venueMapUrl?: string;
  priceGbp?: number | null;
  pintPhotoUrl?: string | null;
  venuePhotoUrl?: string | null;
  passedDownNote?: string;
  drink?: string;
  era?: string;
  createdAt?: string;
};

type LoadState = "loading" | "ready" | "error";

function formatGbp(value: number | null | undefined): string | null {
  return typeof value === "number" && Number.isFinite(value) ? `£${value.toFixed(2)}` : null;
}

// localStorage fallback → DTO groups. The client has no server venue index, so a
// local-only save renders its id as the name (the demo degrade for a signed-out /
// offline viewer); the durable path is the one that carries real names. The map
// url is still correct (?sel=<id>), so the link works either way.
function localSavedDTOs(): Partial<Record<ListType, SavedPubDTO[]>> {
  const local: Partial<Record<ListType, SavedPub[]>> = savedByList();
  const groups: Partial<Record<ListType, SavedPubDTO[]>> = {};
  for (const key of Object.keys(local) as ListType[]) {
    groups[key] = (local[key] ?? []).map((pub) => ({
      venueId: pub.venueId,
      venueName: pub.venueId,
      venueMapUrl: `/map?sel=${encodeURIComponent(pub.venueId)}`,
      listType: pub.listType,
      note: pub.note,
      savedAt: pub.savedAt,
    }));
  }
  return groups;
}

// "you" is the sentinel handle the nav uses (/u/you) before a device handle is
// known. It is NOT a real person's handle — it means "the current viewer". When
// the viewer already has a device handle we redirect /u/you → /u/<handle>; when
// they don't, /u/you renders the first-run passport (story 30).
const YOU_SENTINEL = "you";

export default function ProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  // Route params are a promise in the App Router; unwrap with `use`.
  const routeHandle = normalizeHandle(use(params)?.handle);
  const isYouRoute = routeHandle === YOU_SENTINEL;
  const router = useRouter();

  const [drops, setDrops] = useState<PublicDrop[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  // Saved pubs render as DTOs (venue NAME + map url). Durable when this handle has
  // server-side saves (/api/saved-pubs); otherwise the localStorage fallback
  // (savedByList) mapped into DTOs. Start empty so the server render and the
  // client's first (hydration) paint match, then fill in after mount.
  const [saved, setSaved] = useState<Partial<Record<ListType, SavedPubDTO[]>>>({});
  const [followedLists, setFollowedLists] = useState<FollowedSavedListDTO[]>([]);

  // The viewer's own handle (localStorage `pubmax_handle`), read after mount so
  // the server render and hydration agree. Drives the follow button + whether
  // this is the viewer's own profile.
  const [myHandle, setMyHandle] = useState("");
  // Durable profile row + follow graph, fetched from /api/profiles/[handle].
  // Null profile → fall back to the synthesized-from-drops identity.
  const [stored, setStored] = useState<ProfileRecord | null>(null);
  const [counts, setCounts] = useState<FollowCounts>({ followers: 0, following: 0 });
  const [following, setFollowing] = useState(false);
  // Owner-only "edit my profile" panel; opened from the header's Edit button.
  const [editing, setEditing] = useState(false);
  // Published crawl-story count for this handle, from /api/crawls?author= (the
  // crawl-story store is server-only, so a client route carries the number).
  // Feeds the Pint Passport's "story posts" stat. Starts at 0 so the first paint
  // matches the zeroed passport, then fills in after the fetch.
  const [storyCount, setStoryCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const res = await fetch("/api/pint-drops", { signal: controller.signal });
        if (!res.ok) {
          setState("error");
          return;
        }
        const body: unknown = await res.json();
        const all: PublicDrop[] =
          body && typeof body === "object" && Array.isArray((body as { drops?: unknown }).drops)
            ? ((body as { drops: PublicDrop[] }).drops ?? [])
            : [];
        const mine = all.filter((d) => normalizeHandle(d.handle) === routeHandle);
        setDrops(mine);
        setState("ready");
      } catch {
        // An aborted fetch (unmount / handle change) is not an error state.
        if (controller.signal.aborted) return;
        setState("error");
      }
    }

    void load();
    return () => controller.abort();
  }, [routeHandle]);

  // Load this handle's saved pubs: durable first (the API resolves real venue
  // names for the profile's handle), falling back to the viewer's localStorage
  // view mapped into DTOs. Done in an async callback (not the synchronous effect
  // body) so hydration paints the empty server state first, then swaps in the
  // saves — and so setState only runs in async work (react-hooks rule).
  useEffect(() => {
    const controller = new AbortController();
    async function loadSaved() {
      const durable = routeHandle
        ? await fetchSavedForHandle(routeHandle, controller.signal)
        : null;
      if (controller.signal.aborted) return;
      // Durable hit (even an empty list) is authoritative for this handle; only a
      // null (no handle / request failed) falls back to the local view.
      setSaved(durable ? groupDTOsByList(durable) : localSavedDTOs());
    }
    void loadSaved();
    return () => controller.abort();
  }, [routeHandle]);

  // Followed saved lists are public social context for this handle's saved view:
  // "Ken follows Sam's Date Night list" appears on /u/ken. Reads are fail-soft,
  // matching the API contract, because followed lists are additive context.
  useEffect(() => {
    const controller = new AbortController();
    async function loadFollowedLists() {
      const lists = routeHandle
        ? await fetchFollowedListsForHandle(routeHandle, controller.signal)
        : [];
      if (!controller.signal.aborted) setFollowedLists(lists);
    }
    void loadFollowedLists();
    return () => controller.abort();
  }, [routeHandle]);

  // Read the viewer's own handle after mount (avoids a hydration mismatch — the
  // server can't know localStorage). Done in an async step, not the synchronous
  // effect body, so it satisfies react-hooks/set-state-in-effect (mirrors the
  // loadSaved effect above).
  useEffect(() => {
    let active = true;
    async function loadHandle() {
      try {
        const handle = normalizeHandle(window.localStorage.getItem("pubmax_handle") ?? "");
        if (active) setMyHandle(handle);
      } catch {
        // storage disabled → stays anonymous, follow button hidden
      }
    }
    void loadHandle();
    return () => {
      active = false;
    };
  }, []);

  // This handle's published crawl-story count (story 35 authorship). Best-effort:
  // a failure just leaves 0, so the passport still renders. Runs in an async
  // callback (not the sync effect body) so setState never fires synchronously in
  // the effect — matching the loadSaved / loadProfile pattern above.
  useEffect(() => {
    // /u/you is the sentinel (not a real handle) — it has no stories to count, and
    // the route redirects to the real handle once one is known. Skip the fetch.
    if (!routeHandle || routeHandle === YOU_SENTINEL) return;
    const controller = new AbortController();
    async function loadStoryCount() {
      try {
        const res = await fetch(`/api/crawls?author=${encodeURIComponent(routeHandle)}`, {
          signal: controller.signal,
        });
        // Fail-soft: a non-ok / offline response leaves the count at its default
        // 0. Reset to 0 first (in the async body, not the sync effect) so a
        // handle with no stories clears a previous handle's count.
        const next = res.ok
          ? ((await res.json()) as { count?: number }).count ?? 0
          : 0;
        if (!controller.signal.aborted && Number.isFinite(next)) setStoryCount(next);
      } catch {
        // aborted / offline — keep the previous value (a transient blip)
      }
    }
    void loadStoryCount();
    return () => controller.abort();
  }, [routeHandle]);

  // /u/you resolution: once we know the viewer's device handle, redirect the
  // sentinel route to their real profile (/u/<handle>). With no device handle,
  // /u/you stays put and renders the anonymous first-run passport below. Guarded
  // so we never redirect to /u/you itself (would loop).
  useEffect(() => {
    if (!isYouRoute) return;
    if (myHandle && myHandle !== YOU_SENTINEL) {
      router.replace(`/u/${encodeURIComponent(myHandle)}`);
    }
  }, [isYouRoute, myHandle, router]);

  // Fetch the durable profile row + follow counts + whether the viewer follows
  // this handle. Best-effort: a failure just leaves the synthesized identity and
  // zeroed counts, so the page still renders.
  useEffect(() => {
    if (!routeHandle) return;
    const controller = new AbortController();
    async function loadProfile() {
      try {
        const qs = myHandle ? `?viewer=${encodeURIComponent(myHandle)}` : "";
        const res = await fetch(`/api/profiles/${encodeURIComponent(routeHandle)}${qs}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const body = (await res.json()) as {
          profile?: ProfileRecord | null;
          counts?: FollowCounts;
          viewerFollowing?: boolean;
        };
        setStored(body.profile ?? null);
        if (body.counts) setCounts(body.counts);
        setFollowing(Boolean(body.viewerFollowing));
      } catch {
        // aborted / offline — keep the synthesized fallback
      }
    }
    void loadProfile();
    return () => controller.abort();
  }, [routeHandle, myHandle]);

  const synthesized = deriveProfileFromDrops(routeHandle, drops as ProfileDrop[]);
  // Overlay any durable, user-owned fields on top of the synthesized identity.
  const profile: Profile = {
    ...synthesized,
    displayName: stored?.displayName ?? synthesized.displayName,
    bio: stored?.bio ?? synthesized.bio,
    homeCity: stored?.homeCity ?? synthesized.homeCity,
    avatarUrl: stored?.avatarUrl ?? synthesized.avatarUrl,
  };
  const stats = profileStats(drops as ProfileDrop[]);
  const isOwnProfile = myHandle !== "" && myHandle === routeHandle;
  const isAnonymous = myHandle === "";

  // Pint Passport data (story 29): aggregated from the same drops the page
  // already loaded, plus this handle's published crawl-story count from
  // /api/crawls?author= (storyCount above). A durable crawl story IS the posted
  // crawl AND the story post — both passport inputs draw from the one authored-
  // story number per buildPassport's semantics. On the /u/you first-run route
  // (no device handle) the passport reads as own → shows the "start yours" CTA.
  const passport = buildPassport(drops as ProfileDrop[], {
    crawls: storyCount,
    storyPosts: storyCount,
  });
  const passportIsOwn = isOwnProfile || (isYouRoute && isAnonymous);

  // Claim this handle: an anonymous visitor adopts the route handle as their own
  // demo identity (localStorage `pubmax_handle`) — the same identity that
  // authors a pint drop or a follow. This is a client-only, self-asserted claim
  // (no server ownership check — that arrives with Supabase Auth). Setting
  // myHandle makes this their own profile, unlocking the Edit control.
  function claimHandle() {
    try {
      window.localStorage.setItem("pubmax_handle", routeHandle);
    } catch {
      // storage disabled — the in-memory claim below still owns this session
    }
    setMyHandle(routeHandle);
    setEditing(true);
  }

  // Apply a saved profile row back onto the overlaid identity so the header
  // updates the instant the editor reports success, without a refetch.
  function handleSaved(saved: ProfileRecord) {
    setStored(saved);
    setEditing(false);
  }

  // Header action slot. Three mutually-exclusive states:
  //  • own profile  → Edit (toggles the inline editor)
  //  • anonymous    → Claim this handle (adopt it, then edit)
  //  • other viewer → Follow
  // On the /u/you sentinel route we never offer "Claim this handle" ("you" isn't
  // a real handle to adopt) — the passport's first-run CTA drives the next step.
  const headerActions = isOwnProfile ? (
    <button
      type="button"
      className="profileEditToggle"
      aria-expanded={editing}
      onClick={() => setEditing((open) => !open)}
    >
      {editing ? "Close editor" : "Edit profile"}
    </button>
  ) : isAnonymous && !isYouRoute ? (
    <button type="button" className="profileClaimBtn" onClick={claimHandle}>
      Claim this handle
    </button>
  ) : isYouRoute ? null : (
    <FollowButton
      targetHandle={routeHandle}
      followerHandle={myHandle}
      initialFollowing={following}
      onCountsChange={setCounts}
    />
  );

  return (
    <div className="lp profilePage">
      <SiteNav active="profile" />

      <main className="container profileMain">
        {!routeHandle ? (
          <p className="profileEmpty">That profile link is missing a handle.</p>
        ) : state === "error" ? (
          <div className="profileErrorState">
            <ProfileHeader
              profile={profile}
              stats={stats}
              drops={drops}
              followers={counts.followers}
              following={counts.following}
              actions={headerActions}
            />
            <p className="profileEmpty">
              Couldn&apos;t load pints right now. Please try again in a moment.
            </p>
          </div>
        ) : (
          <>
            <ProfileHeader
              profile={profile}
              stats={stats}
              drops={drops}
              followers={counts.followers}
              following={counts.following}
              actions={headerActions}
            />

            <PintPassport
              handle={routeHandle}
              displayName={profile.displayName}
              data={passport}
              isOwn={passportIsOwn}
            />

            {isOwnProfile && editing ? (
              <ProfileEditor
                handle={routeHandle}
                initial={{
                  // Only pre-fill from durable, user-owned values — never the
                  // synthesized bio/name (those are placeholders the user hasn't
                  // authored, so the fields should read as empty and editable).
                  displayName: stored?.displayName,
                  bio: stored?.bio,
                  homeCity: stored?.homeCity,
                  avatarUrl: stored?.avatarUrl,
                }}
                onSaved={handleSaved}
                onClose={() => setEditing(false)}
              />
            ) : null}

            <section className="profileDropsSection" aria-labelledby="dropsHeading">
              <h2 id="dropsHeading" className="profileSectionHeading">
                Recent Pint Drops
              </h2>

              {state === "loading" ? (
                <p className="profileEmpty">Loading pints…</p>
              ) : drops.length === 0 ? (
                <p className="profileEmpty">No pints logged under @{routeHandle} yet.</p>
              ) : (
                <ul className="profileDropsGrid">
                  {drops.map((drop, i) => {
                    const price = formatGbp(drop.priceGbp);
                    const photo = drop.pintPhotoUrl || drop.venuePhotoUrl || null;
                    const key = (drop.id as string | undefined) ?? `${drop.venueId}:${i}`;
                    // The human pub name (never the raw venue id): prefer the
                    // server-enriched venueName, fall back to the friendly label.
                    const venueLabel = drop.venueName || VENUE_FALLBACK_LABEL;
                    // Tapping the venue opens the map with it selected (§9). Use
                    // the enriched map url, or build the same ?sel=<id> fallback.
                    const venueHref =
                      drop.venueMapUrl ?? `/map?sel=${encodeURIComponent(drop.venueId)}`;
                    return (
                      <li className="profileDropCard" key={key}>
                        {photo ? (
                          <div className="profileDropPhoto">
                            <Image
                              src={photo}
                              alt={drop.drink ? `${drop.drink} at ${venueLabel}` : ""}
                              width={320}
                              height={220}
                              unoptimized
                            />
                          </div>
                        ) : (
                          <div className="profileDropPhoto profileDropPhotoEmpty" aria-hidden="true">
                            🍺
                          </div>
                        )}
                        <div className="profileDropBody">
                          <div className="profileDropTop">
                            <Link className="profileDropVenue" href={venueHref}>
                              {venueLabel}
                            </Link>
                            {price ? <span className="profileDropPrice">{price}</span> : null}
                          </div>
                          {drop.passedDownNote ? (
                            <p className="profileDropNote">{drop.passedDownNote}</p>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <SavedPubList
              ownerHandle={isYouRoute ? myHandle : routeHandle}
              groups={saved}
              followedLists={followedLists}
            />
          </>
        )}
      </main>
    </div>
  );
}
