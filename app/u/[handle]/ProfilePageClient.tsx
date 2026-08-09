"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState, useSyncExternalStore } from "react";

import ClaimMomentWelcome from "@/components/profile/ClaimMomentWelcome";
import ContributionLanesCard from "@/components/profile/ContributionLanesCard";
import FirstActionsRow from "@/components/profile/FirstActionsRow";
import FollowButton from "@/components/profile/FollowButton";
import ProfileMessageButton from "@/components/messages/ProfileMessageButton";
import NextBadgeChips from "@/components/profile/NextBadgeChips";
import OutTonightBoard from "@/components/profile/OutTonightBoard";
import OutTonightCrewLine from "@/components/profile/OutTonightCrewLine";
import OutTonightToggle from "@/components/profile/OutTonightToggle";
import PintPassport from "@/components/profile/PintPassport";
import ProfileEditor from "@/components/profile/ProfileEditor";
import PrivateIdentityEditor from "@/components/identity/PrivateIdentityEditor";
import ProfileHeader from "@/components/profile/ProfileHeader";
import SocialLinksEditor from "@/components/profile/SocialLinksEditor";
import type { PublicSocialLink } from "@/lib/socialConnections";
import ProfileTimeline from "@/components/profile/ProfileTimeline";
import PubmaxxAccountHub from "@/components/profile/PubmaxxAccountHub";
import SavedPubList from "@/components/profile/SavedPubList";
import WantedList from "@/components/wanted/WantedList";
import YourContributionsCard from "@/components/profile/YourContributionsCard";
import SiteNav from "@/components/nav/SiteNav";
import SiteNavMore, {
  type SiteNavMoreItem,
} from "@/components/nav/SiteNavMore";
import { useAuth } from "@/components/auth/AuthProvider";
import { BADGE_EVENTS } from "@/lib/badgeEvents";
import {
  BADGE_EVENT_OPT_INS_STORAGE_KEY,
  addBadgeEventOptIn,
  parseBadgeEventOptIns,
} from "@/lib/badgeEventOptIn";
import type { FollowCounts } from "@/lib/followStore";
import { buildPassport } from "@/lib/passport";
import { buildProfileBadgeEventOptions } from "@/lib/profileBadgeEventGate";
import {
  deriveProfileFromDrops,
  normalizeHandle,
  profileStats,
  withStoredProfile,
  type Profile,
  type ProfileDrop,
  type PublicProfile,
} from "@/lib/profiles";
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
import { venueMapUrl } from "@/lib/venueMapUrl";
import { currentMode, modeEnablesLegacy } from "@/lib/viewMode";

import "./profile.css";

// Public profile route /u/[handle]. Client/dynamic on purpose: no
// generateStaticParams, so the build never pre-renders every handle. It fetches
// the public Pint Drops feed, filters to this handle, synthesizes a demo
// profile, and renders the header, the handle's recent drops (photo-first), and
// their saved venues (from localStorage). It NEVER crashes: a missing handle, a
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

type LoadState = "loading" | "ready" | "error" | "gone";

const BADGE_EVENT_IDS = BADGE_EVENTS.map((event) => event.id);
const BADGE_EVENT_OPT_IN_CHANGED = "pubmax-badge-event-opt-ins-changed";

function subscribeBadgeEventOptIns(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(BADGE_EVENT_OPT_IN_CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(BADGE_EVENT_OPT_IN_CHANGED, onChange);
  };
}

function currentBadgeEventOptInRaw(): string {
  try {
    return localStorage.getItem(BADGE_EVENT_OPT_INS_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function subscribeLegacyMode(onChange: () => void): () => void {
  const el = document.documentElement;
  const mo = new MutationObserver(onChange);
  mo.observe(el, { attributes: true, attributeFilter: ["data-mode", "data-legacy"] });
  window.addEventListener("storage", onChange);
  return () => {
    mo.disconnect();
    window.removeEventListener("storage", onChange);
  };
}

function currentLegacyMode(): boolean {
  if (typeof document !== "undefined" && document.documentElement.dataset.legacy === "1") {
    return true;
  }
  try {
    return modeEnablesLegacy(currentMode());
  } catch {
    return false;
  }
}

function isEventActive(event: (typeof BADGE_EVENTS)[number], now: string): boolean {
  const time = Date.parse(now);
  const startsAt = Date.parse(event.startsAt);
  const endsAt = Date.parse(event.endsAt);
  return (
    Number.isFinite(time) &&
    Number.isFinite(startsAt) &&
    Number.isFinite(endsAt) &&
    startsAt < endsAt &&
    time >= startsAt &&
    time < endsAt
  );
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
      venueMapUrl: venueMapUrl(pub.venueId),
      listType: pub.listType,
      note: pub.note,
      savedAt: pub.savedAt,
    }));
  }
  return groups;
}

// "you" is the sentinel handle the nav uses (/u/you) before a viewer handle is
// known. It is NOT a real person's handle - it means "the current viewer". A
// signed-in account handle or signed-out device handle redirects /u/you to the
// real profile; without either, /u/you renders the first-run passport (story 30).
const YOU_SENTINEL = "you";

function isNightMemoriesHash(hash: string): boolean {
  return hash.replace(/^#/, "").toLowerCase() === "night-memories";
}

export default function ProfilePageClient({ params }: { params: Promise<{ handle: string }> }) {
  // Route params are a promise in the App Router; unwrap with `use`.
  const routeHandle = normalizeHandle(use(params)?.handle);
  const isYouRoute = routeHandle === YOU_SENTINEL;
  const router = useRouter();
  const { user, handle: accountHandle, signOut } = useAuth();
  const storedBadgeEventOptInRaw = useSyncExternalStore(
    subscribeBadgeEventOptIns,
    currentBadgeEventOptInRaw,
    () => "",
  );
  const legacyMode = useSyncExternalStore(subscribeLegacyMode, currentLegacyMode, () => true);
  const [badgeEventOptInOverride, setBadgeEventOptInOverride] = useState<string | null>(null);
  const [badgeEventsNow, setBadgeEventsNow] = useState(() => new Date().toISOString());
  const badgeEventOptIns = parseBadgeEventOptIns(
    badgeEventOptInOverride ?? storedBadgeEventOptInRaw,
    BADGE_EVENT_IDS,
  );

  const [drops, setDrops] = useState<PublicDrop[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  // Saved venues render as DTOs (venue NAME + map url). Durable when this handle has
  // server-side saves (/api/saved-pubs); otherwise the localStorage fallback
  // (savedByList) mapped into DTOs. Start empty so the server render and the
  // client's first (hydration) paint match, then fill in after mount.
  const [saved, setSaved] = useState<Partial<Record<ListType, SavedPubDTO[]>>>({});
  const [followedLists, setFollowedLists] = useState<FollowedSavedListDTO[]>([]);

  // Signed-out fallback handle, read after mount so the server render and
  // hydration agree. Signed-in ownership comes from the account identity.
  const [myHandle, setMyHandle] = useState("");
  const viewerHandle = user ? normalizeHandle(accountHandle ?? "") : myHandle;
  // The owner's own linked socials, public on their card by their own choice.
  const [socialLinks, setSocialLinks] = useState<PublicSocialLink[]>([]);
  // Durable profile row + follow graph, fetched from /api/profiles/[handle].
  // Null profile → fall back to the synthesized-from-drops identity.
  const [stored, setStored] = useState<PublicProfile | null>(null);
  const [counts, setCounts] = useState<FollowCounts>({ followers: 0, following: 0 });
  const [following, setFollowing] = useState(false);
  // Owner-only "edit my profile" panel; opened from the header's Edit button.
  const [editing, setEditing] = useState(false);
  // Post-save confirmation shown back in view mode; clears itself shortly.
  const [savedNotice, setSavedNotice] = useState(false);
  // Published crawl-story count for this handle, from /api/crawls?author= (the
  // crawl-story store is server-only, so a client route carries the number).
  // Feeds the Pint Passport's "story posts" stat. Starts at 0 so the first paint
  // matches the zeroed passport, then fills in after the fetch.
  const [storyCount, setStoryCount] = useState(0);
  const [nightMemoriesInvite, setNightMemoriesInvite] = useState(false);

  useEffect(() => {
    if (!routeHandle || isYouRoute) return;
    const controller = new AbortController();
    async function resolveAlias() {
      const response = await fetch(`/api/identity/handle/resolve?handle=${encodeURIComponent(routeHandle)}`, { signal: controller.signal }).catch(() => null);
      if (!response?.ok || controller.signal.aborted) return;
      const resolution = await response.json() as {
        status?: string;
        currentHandle?: string;
        redirect?: boolean;
      };
      // Auth user deleted: handle stays reserved, public profile is gone.
      if (resolution.status === "gone") {
        setState("gone");
        return;
      }
      if (resolution.redirect && resolution.currentHandle) {
        router.replace(`/u/${encodeURIComponent(resolution.currentHandle)}`);
      }
    }
    void resolveAlias();
    return () => controller.abort();
  }, [isYouRoute, routeHandle, router]);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const res = await fetch(
          `/api/pint-drops?author=${encodeURIComponent(routeHandle)}`,
          { signal: controller.signal },
        );
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
        // Tombstone wins over a later drops load: never paint a live profile.
        setState((prev) => (prev === "gone" ? prev : "ready"));
      } catch {
        // An aborted fetch (unmount / handle change) is not an error state.
        if (controller.signal.aborted) return;
        setState((prev) => (prev === "gone" ? prev : "error"));
      }
    }

    void load();
    return () => controller.abort();
  }, [routeHandle]);

  // Load this handle's saved venues: durable first (the API resolves real venue
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

  // Read the signed-out fallback handle after mount. The server cannot know
  // localStorage, and signed-in identity remains account-owned.
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

  // /u/you resolution: once viewer identity is known, redirect the sentinel
  // route to its real profile. With no signed-out fallback, /u/you stays put and
  // renders the anonymous first-run passport below. Preserve any hash (e.g.
  // #night-memories from the landing CTA) so the destination can honour it.
  useEffect(() => {
    if (!isYouRoute) return;
    if (viewerHandle && viewerHandle !== YOU_SENTINEL) {
      const hash = window.location.hash;
      router.replace(`/u/${encodeURIComponent(viewerHandle)}${hash}`);
    }
  }, [isYouRoute, router, viewerHandle]);

  // Signed-out /u/you#night-memories: NightMemoryStudio only mounts on a signed-in
  // own profile, so the hash would be a dead end. Scroll to claim and say honestly
  // that Memories need a claimed handle first.
  useEffect(() => {
    if (!isYouRoute || viewerHandle !== "") return;
    if (!isNightMemoriesHash(window.location.hash)) return;
    // Frame callback keeps the effect body free of synchronous setState; the
    // scroll work below already happens against the painted DOM.
    const inviteFrame = window.requestAnimationFrame(() =>
      setNightMemoriesInvite(true),
    );
    void inviteFrame;
    const target = document.getElementById("account-settings");
    if (!target) return;
    window.history.replaceState(null, "", "#account-settings");
    target.scrollIntoView({ block: "start" });
    const claimLink = document.querySelector<HTMLAnchorElement>(
      '.youIdentityActions a[href="#account-settings"]',
    );
    claimLink?.focus({ preventScroll: true });
  }, [isYouRoute, viewerHandle]);

  // Fetch the durable profile row + follow counts + whether the viewer follows
  // this handle. Best-effort: a failure just leaves the synthesized identity and
  // zeroed counts, so the page still renders.
  useEffect(() => {
    if (!routeHandle) return;
    const controller = new AbortController();
    async function loadProfile() {
      try {
        const qs = viewerHandle
          ? `?viewer=${encodeURIComponent(viewerHandle)}`
          : "";
        const res = await fetch(`/api/profiles/${encodeURIComponent(routeHandle)}${qs}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const body = (await res.json()) as {
          profile?: PublicProfile | null;
          status?: string;
          socialLinks?: PublicSocialLink[];
          counts?: FollowCounts;
          viewerFollowing?: boolean;
        };
        if (body.status === "gone") {
          setStored(null);
          setSocialLinks([]);
          setState("gone");
          if (body.counts) setCounts(body.counts);
          return;
        }
        setStored(body.profile ?? null);
        setSocialLinks(body.socialLinks ?? []);
        if (body.counts) setCounts(body.counts);
        setFollowing(Boolean(body.viewerFollowing));
      } catch {
        // aborted / offline — keep the synthesized fallback
      }
    }
    void loadProfile();
    return () => controller.abort();
  }, [routeHandle, viewerHandle]);

  // Overlay any durable, user-owned fields on top of the synthesized identity.
  const profile: Profile = withStoredProfile(
    deriveProfileFromDrops(routeHandle, drops as ProfileDrop[]),
    stored,
  );
  const stats = profileStats(drops as ProfileDrop[]);
  const isOwnProfile = viewerHandle !== "" && viewerHandle === routeHandle;
  const isAnonymous = !user && viewerHandle === "";
  // Signed-out /u/you: the viewer has no handle yet. This is an INVITATION, not a
  // profile — so it shows only the honest "make the night yours" intro + the
  // claim/account surface, never the pseudo-profile scaffolding (a "@you"
  // passport header, timeline, saved list) that reads like a bug (spec #393).
  const youSignedOut = isYouRoute && isAnonymous;
  const passportIsOwn = isOwnProfile || (isYouRoute && isAnonymous);
  const joinedBadgeEventIds = new Set(badgeEventOptIns.optedInEventIds);
  const joinableBadgeEvents =
    passportIsOwn && !legacyMode
      ? BADGE_EVENTS.filter(
          (event) => isEventActive(event, badgeEventsNow) && !joinedBadgeEventIds.has(event.id),
        )
      : [];

  // Pint Passport data (story 29): aggregated from the same drops the page
  // already loaded, plus this handle's published crawl-story count from
  // /api/crawls?author= (storyCount above). A durable crawl story IS the posted
  // crawl AND the story post — both passport inputs draw from the one authored-
  // story number per buildPassport's semantics. On the anonymous /u/you
  // first-run route, the passport reads as own and shows the "start yours" CTA.
  const passport = buildPassport(drops as ProfileDrop[], {
    crawls: storyCount,
    storyPosts: storyCount,
    badgeEvents: buildProfileBadgeEventOptions({
      isOwnPassport: passportIsOwn,
      legacyMode,
      now: badgeEventsNow,
      optIns: badgeEventOptIns,
    }),
  });

  function joinBadgeEvent(eventId: string) {
    const now = new Date();
    const nowIso = now.toISOString();
    const event = BADGE_EVENTS.find((candidate) => candidate.id === eventId);
    // Re-check the window at click time: a Join button rendered before the
    // event ended must not persist a post-expiry opt-in (badgeEventsNow is
    // captured at mount and can be stale).
    setBadgeEventsNow(nowIso);
    if (!event || !isEventActive(event, nowIso)) return;
    const next = addBadgeEventOptIn(
      badgeEventOptInOverride ?? currentBadgeEventOptInRaw(),
      eventId,
      now,
      BADGE_EVENT_IDS,
    );
    let persisted = false;
    try {
      window.localStorage.setItem(BADGE_EVENT_OPT_INS_STORAGE_KEY, next.serialized);
      persisted = true;
    } catch {
      // Storage disabled/private mode — keep the opt-in for this mounted session.
    }
    // Clear the optimistic override once the write lands so the store (which
    // also sees cross-tab "storage" updates) is the source of truth; only keep
    // the override as a session fallback when the write failed.
    setBadgeEventOptInOverride(persisted ? null : next.serialized);
    window.dispatchEvent(new Event(BADGE_EVENT_OPT_IN_CHANGED));
  }

  // Claim this handle: an anonymous visitor adopts the route handle as their own
  // demo identity (localStorage `pubmax_handle`), the same identity that authors
  // a pint drop or a follow. This remains a client-only, self-asserted signed-out
  // claim. Signed-in ownership comes from the account handle instead.
  function claimHandle() {
    try {
      window.localStorage.setItem("pubmax_handle", routeHandle);
    } catch {
      // storage disabled — the in-memory claim below still owns this session
    }
    setMyHandle(routeHandle);
    setEditing(true);
  }

  useEffect(() => {
    if (!savedNotice) return;
    const timeout = window.setTimeout(() => setSavedNotice(false), 4_000);
    return () => window.clearTimeout(timeout);
  }, [savedNotice]);

  // Editing must be unmistakable: opening it lands the reader on the editing
  // surface itself, not wherever the toggle happened to sit.
  function openEditor() {
    setSavedNotice(false);
    setEditing(true);
    window.requestAnimationFrame(() => {
      document
        .getElementById("profile-editing")
        ?.scrollIntoView({ block: "start" });
    });
  }

  // "Edit profile" is reachable from the site nav, which can only carry a URL,
  // so ?edit=1 opens the editing surface on arrival. The parameter is spent
  // once: it is stripped straight away, so Back never re-opens the editor.
  useEffect(() => {
    if (!isOwnProfile) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("edit") !== "1") return;
    url.searchParams.delete("edit");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    const frame = window.requestAnimationFrame(() => {
      setEditing(true);
      window.requestAnimationFrame(() => {
        document.getElementById("profile-editing")?.scrollIntoView({ block: "start" });
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isOwnProfile]);

  // Apply a saved profile row back onto the overlaid identity so the header
  // updates the instant the editor reports success, without a refetch. The
  // surface returns to view mode and says so.
  function handleSaved(saved: PublicProfile) {
    setStored(saved);
    setEditing(false);
    setSavedNotice(true);
  }

  // Header action slot. Three mutually-exclusive states:
  //  • own profile  → Edit (toggles the inline editor)
  //  • anonymous    → Claim this handle (adopt it, then edit)
  //  • other viewer → Follow
  // On the /u/you sentinel route we never offer "Claim this handle" ("you" isn't
  // a real handle to adopt) — the passport's first-run CTA drives the next step.
  const headerActions = isOwnProfile ? (
    <>
      {/* The crew-invite loop's entry point: your own add link. Opening it shows
          the share surface (ConfirmFollow's self branch), so a friend can add
          you at the table and you become each other's lot. */}
      <Link className="profileInviteLink" href={`/add/${encodeURIComponent(routeHandle)}`}>
        Invite your lot
      </Link>
      <button
        type="button"
        className="profileEditToggle"
        aria-expanded={editing}
        onClick={() => {
          if (editing) {
            setEditing(false);
          } else {
            openEditor();
          }
        }}
      >
        {editing ? "Close editor" : "Edit profile"}
      </button>
      <Link className="profilePalLink" href="/pal">Meet your Pub Pal</Link>
    </>
  ) : isAnonymous && !isYouRoute ? (
    <button type="button" className="profileClaimBtn" onClick={claimHandle}>
      Claim this handle
    </button>
  ) : isYouRoute ? null : (
    <>
      <FollowButton
        targetHandle={routeHandle}
        followerHandle={viewerHandle}
        initialFollowing={following}
        onCountsChange={setCounts}
      />
      {/* E4: additive 1:1 messaging control. Only renders when the viewer has a
          handle distinct from this profile (the button self-guards). */}
      <ProfileMessageButton
        targetHandle={routeHandle}
        viewerHandle={viewerHandle}
      />
    </>
  );
  const profileOptions: SiteNavMoreItem[] = [
    {
      id: "edit-profile",
      label: "Edit profile",
      description: "Change your name, photos, bio, or what you're into",
      onSelect: openEditor,
    },
    {
      id: "analytics-settings",
      label: "Analytics choices",
      description: "Review optional usage analytics",
      onSelect: () => {
        const target = document.getElementById("analytics-settings");
        if (!target) return;
        window.history.replaceState(null, "", "#analytics-settings");
        target.scrollIntoView({ block: "start" });
      },
    },
    {
      href: "/about",
      label: "About",
      description: "What PUBMAXX is for",
    },
    {
      href: "/privacy",
      label: "Privacy",
      description: "How PUBMAXX handles data",
    },
    {
      href: "/terms",
      label: "Terms",
      description: "Rules for using PUBMAXX",
    },
    ...(user
      ? [
          {
            id: "sign-out",
            label: "Sign out",
            description: "End this account session",
            onSelect: signOut,
          } satisfies SiteNavMoreItem,
        ]
      : []),
  ];

  return (
    <div className="lp profilePage">
      <SiteNav active="profile" />

      <main id="main" className="container profileMain">
        {!routeHandle ? (
          <p className="profileEmpty">That profile link is missing a handle.</p>
        ) : state === "gone" ? (
          <section className="profileGoneState" aria-labelledby="profile-gone-title">
            <p className="profileSectionKicker">@{routeHandle}</p>
            <h1 id="profile-gone-title">This account has left</h1>
            <p className="profileEmpty">
              The handle is still reserved. Past pints stay attributed, but
              there is no live profile here any more.
            </p>
            <p className="profileEmpty">
              <Link href="/map">Back to the map</Link>
            </p>
          </section>
        ) : state === "error" ? (
          <div className="profileErrorState">
            <ProfileHeader
              profile={profile}
              stats={stats}
              socialLinks={socialLinks}
              crawls={storyCount}
              memories={stats.memoriesPosted}
              drops={drops}
              followers={counts.followers}
              following={counts.following}
              actions={headerActions}
            />
            <p className="profileEmpty">
              Couldn&apos;t load pints right now. Try again.
            </p>
          </div>
        ) : (
          <>
            {youSignedOut ? (
              // Signed-out /u/you is an invitation, not a profile — it keeps the
              // single full-width column (intro + claim surface), never the
              // multi-pane scaffolding.
              <>
                <section className="youIdentityIntro" aria-labelledby="you-title">
                  <div className="youIdentityAvatar" aria-hidden="true">PXX</div>
                  <div>
                    <p className="profileSectionKicker">Your PUBMAXX identity</p>
                    <h1 id="you-title">Make the night yours.</h1>
                    <p>Claim a unique @handle, meet your Pub Pal, and keep every moment in one place.</p>
                    {nightMemoriesInvite ? (
                      <p className="youMemoriesInvite" role="status">
                        Private Memories need a claimed @handle on your account. Claim yours below to keep nights in one place.
                      </p>
                    ) : null}
                  </div>
                  <div className="youIdentityActions">
                    <a href="#account-settings">Claim your @handle</a>
                    <Link href="/pal">Meet your Pub Pal</Link>
                  </div>
                </section>

                <WantedList />

                <div id="account-settings">
                  <PubmaxxAccountHub />
                </div>
              </>
            ) : (
              // Desktop multi-pane (≥1024): identity/bio docks into a sticky left
              // pane; passport, timeline and saved flow in the main pane. Both
              // panes are display:contents below the breakpoint, so the phone
              // layout is the same single column it was before.
              <div className="profileLayout">
                {isOwnProfile ? (
                  <div className="profileOwnerUtilities">
                    <SiteNavMore
                      className="profileOptions"
                      label="Options"
                      ariaLabel="Profile options"
                      items={profileOptions}
                    />
                  </div>
                ) : null}
                <div className="profileIdentityPane">
                  <div className={isOwnProfile ? "youProfileIdentity" : undefined}>
                    <ProfileHeader
                      profile={profile}
                      stats={stats}
                      socialLinks={socialLinks}
                      crawls={storyCount}
                      memories={stats.memoriesPosted}
                      drops={drops}
                      followers={counts.followers}
                      following={counts.following}
                      actions={headerActions}
                    />
                  </div>
                </div>

                <div className="profileContentPane">
                  {passportIsOwn && !youSignedOut ? (
                    <div id="passport">
                      <PintPassport
                        handle={routeHandle}
                        displayName={profile.displayName}
                        data={passport}
                        isOwn={passportIsOwn}
                        hero
                      />
                    </div>
                  ) : null}

                  {isOwnProfile ? (
                    <YourContributionsCard handle={routeHandle} claimNudge />
                  ) : null}

                  {isOwnProfile ? (
                    <>
                      <ClaimMomentWelcome />
                      <FirstActionsRow />
                      <ContributionLanesCard handle={routeHandle} />
                      <OutTonightToggle handle={routeHandle} />
                      <OutTonightBoard viewerHandle={routeHandle} />
                    </>
                  ) : null}

                  {(isYouRoute || isOwnProfile) && !youSignedOut ? (
                    <nav className="youProfileTabs" aria-label="Your profile sections">
                      <a href="#timeline">Moments</a>
                      <a href="#passport">Passport</a>
                      <a href="#wanted">Wanted</a>
                      <a href="#saved-pubs">Saved</a>
                      <a href="#account-settings">Settings</a>
                    </nav>
                  ) : null}

                  {!passportIsOwn ? (
                    <PintPassport
                      handle={routeHandle}
                      displayName={profile.displayName}
                      data={passport}
                      isOwn={passportIsOwn}
                      hero={false}
                    />
                  ) : null}

                  {!isOwnProfile && routeHandle && routeHandle !== YOU_SENTINEL ? (
                    <OutTonightCrewLine ownerHandle={routeHandle} viewerHandle={viewerHandle} />
                  ) : null}

                  {/* Quest chips (Loop 2): next-badge progress for the viewed handle.
                      NextBadgeChips fetches public drops and filters by handle — works
                      for any profile with drops; renders nothing when empty. Own
                      profile also surfaces local "Crawls walked" from crawlCompletion. */}
                  {routeHandle && routeHandle !== YOU_SENTINEL ? (
                    <NextBadgeChips handle={routeHandle} showCrawlsWalked={isOwnProfile} />
                  ) : null}

                  {!youSignedOut && joinableBadgeEvents.length ? (
                    <section className="passportQuestOptIn" aria-labelledby="questOptInHeading">
                      <div>
                        <p className="passportQuestOptInKicker">Optional events</p>
                        <h2 id="questOptInHeading" className="passportQuestOptInTitle">
                          Seasonal badges
                        </h2>
                        <p className="passportQuestOptInCopy">
                          Join only if you want them. Progress starts from the moment you join.
                        </p>
                      </div>
                      <div className="passportQuestOptInActions">
                        {joinableBadgeEvents.map((event) => (
                          <button
                            key={event.id}
                            type="button"
                            className="passportCta passportCtaPrimary"
                            onClick={() => joinBadgeEvent(event.id)}
                          >
                            Join {event.label}
                          </button>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {isOwnProfile && savedNotice && !editing ? (
                    <p className="profileSavedNotice" role="status">
                      Saved
                    </p>
                  ) : null}

                  {isOwnProfile && editing ? (
                    <section
                      id="profile-editing"
                      className="profileEditingSurface"
                      aria-labelledby="profile-editing-title"
                    >
                      <h2 id="profile-editing-title">Editing your profile</h2>
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
                          coverUrl: stored?.coverUrl,
                          favouriteDrink: stored?.favouriteDrink,
                          interests: stored?.interests,
                          workplace: stored?.workplace,
                        }}
                        onSaved={handleSaved}
                        onClose={() => setEditing(false)}
                      />
                      {/* Linked socials are public content the owner typed in,
                          so they edit beside the public fields, never beside
                          the private ones below. Signed-out demo owners have no
                          account to hang a link on. */}
                      {user ? <SocialLinksEditor /> : null}
                      {/* Private personal fields (email, date of birth, gender)
                          live beside the public editor so the owner finds them
                          where they expect to edit themselves. Signed-out demo
                          owners see the editor's own sign-in prompt. */}
                      {user ? (
                        <div className="accountHubGrid profilePrivateDetails">
                          <PrivateIdentityEditor />
                        </div>
                      ) : null}
                    </section>
                  ) : null}

                  {!youSignedOut ? (
                    <section id="timeline" className="profileDropsSection" aria-labelledby="dropsHeading">
                      <h2 id="dropsHeading" className="profileSectionHeading">
                        Timeline
                      </h2>

                      {state === "loading" ? (
                        <div className="profileTimelineSkel feedList" aria-hidden="true">
                          {Array.from({ length: 2 }).map((_, i) => (
                            <div key={i} className="feedCard feedCardSkeleton">
                              <div className="feedSkelHead">
                                <span className="feedSkelAvatar" />
                                <span className="feedSkelLine feedSkelLineShort" />
                              </div>
                              <div className="feedSkelPhoto" />
                              <div className="feedSkelLine" />
                            </div>
                          ))}
                        </div>
                      ) : drops.length === 0 ? (
                        <p className="profileEmpty">No pints logged under @{routeHandle} yet.</p>
                      ) : (
                        <ProfileTimeline drops={drops as Array<Record<string, unknown>>} />
                      )}
                    </section>
                  ) : null}

                  {/* /u/you redirects to the real handle the moment one is
                      known, so gating this on the sentinel alone left the
                      owner's own Wanted tab pointing at nothing. */}
                  {isYouRoute || isOwnProfile ? <WantedList /> : null}

                  {!youSignedOut ? (
                    <div id="saved-pubs">
                      <SavedPubList
                        ownerHandle={isYouRoute ? viewerHandle : routeHandle}
                        groups={saved}
                        followedLists={followedLists}
                      />
                    </div>
                  ) : null}

                  {isYouRoute || isOwnProfile ? (
                    <div id="account-settings">
                      <PubmaxxAccountHub />
                    </div>
                  ) : null}
                </div>
              </div>
            )}

            <footer className="profileFloor">
              <p>
                PUBMAXX is for over-18s. Drink responsibly, know the facts at{" "}
                <a href="https://www.drinkaware.co.uk" rel="noreferrer">
                  drinkaware.co.uk
                </a>
                .
              </p>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
