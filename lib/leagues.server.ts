import "server-only";

// Private leagues: make one, join one with a code, read one, leave or delete it.
// lib/leagueStore.ts keeps who is in which league; this module decides who the
// reader may see in it and counts their points and districts.
//
// WHO THE READER SEES. Themselves, always. Another member only when neither
// side blocks or mutes the other, moderation has not withdrawn their handle,
// and, for a private account, the two are mates. A hidden member is left out
// of the table and the map alike, so nothing they did shows through. A
// relationship read that fails makes the whole league unavailable rather than
// quietly short.
//
// Points come from each member's own records (lib/points.server.ts), so a
// league holds no score of its own and shows none that nobody earned.

import { randomInt } from "node:crypto";

import { accountIsPrivate } from "@/lib/accountVisibility";
import { withdrawnHandles } from "@/lib/accountPublicAccess.server";
import { followStore } from "@/lib/followStore";
import { leagueStore, type LeagueRecord, type LeagueStore } from "@/lib/leagueStore";
import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  leagueDistricts,
  type LeagueBoard,
  type LeagueRow,
  type LeagueSummary,
} from "@/lib/leagues";
import { inTurns } from "@/lib/matesBoard.server";
import { normalizeViewerHandle } from "@/lib/pintDrops";
import { readLondonDistrictPubs, readPointsStandingWithVisits, type PointsStandingWithVisits } from "@/lib/points.server";
import { isProfileTombstoned, profileStore, type ProfileRecord } from "@/lib/profileStore";
import { socialMemoryBlocked } from "@/lib/socialBlockMemory";
import { eitherMutes, type MateViewer } from "@/lib/socialMutual.server";
import { socialRelationshipBetweenProfiles } from "@/lib/socialRelationships.server";
import { isSupabaseConfigured } from "@/lib/supabase";

/** The verified Social account asking, with the auth user id leagues key to. */
export type LeagueViewer = MateViewer & { authUserId: string };

export type LeagueDependencies = {
  store: LeagueStore;
  profile(id: string): Promise<ProfileRecord | null>;
  /** "blocked", "mutual" or "other". Throws when it cannot tell. */
  relationship(viewer: LeagueViewer, member: ProfileRecord): Promise<"blocked" | "mutual" | "other">;
  /** Throws when it cannot tell. */
  mutes(viewer: LeagueViewer, member: ProfileRecord): Promise<boolean>;
  /** The handles moderation withdrew from public view. Throws when it cannot tell. */
  withdrawn(handles: readonly string[]): Promise<ReadonlySet<string>>;
  standing(member: ProfileRecord): Promise<PointsStandingWithVisits>;
  districtPubs(): Promise<ReadonlyMap<string, readonly string[]>>;
  inviteCode(): string;
};

async function relationship(viewer: LeagueViewer, member: ProfileRecord): Promise<"blocked" | "mutual" | "other"> {
  if (socialMemoryBlocked(viewer.profileId, member.id)) return "blocked";
  if (!isSupabaseConfigured()) {
    // Keyless dev has no relationship RPC; the memory block set above is its
    // whole block list, and the follow graph says who is mutual.
    const follows = followStore();
    const [out, back] = await Promise.all([
      follows.isFollowing(viewer.handle, member.handle),
      follows.isFollowing(member.handle, viewer.handle),
    ]);
    return out && back ? "mutual" : "other";
  }
  const answer = await socialRelationshipBetweenProfiles(viewer.profileId, member.id);
  if (answer === "unavailable") throw new Error("League member relationship unavailable");
  return answer === "blocked" ? "blocked" : answer === "mutual" ? "mutual" : "other";
}

const defaultDependencies = (): LeagueDependencies => ({
  store: leagueStore(),
  profile: (id) => profileStore().getById(id),
  relationship,
  mutes: (viewer, member) => eitherMutes(viewer, member.handle),
  withdrawn: withdrawnHandles,
  standing: readPointsStandingWithVisits,
  districtPubs: readLondonDistrictPubs,
  inviteCode: () =>
    Array.from({ length: INVITE_CODE_LENGTH }, () => INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)]).join(""),
});

const deps = (overrides: Partial<LeagueDependencies>): LeagueDependencies => ({ ...defaultDependencies(), ...overrides });

const memberKey = (viewer: LeagueViewer) => ({ userId: viewer.authUserId, profileId: viewer.profileId });

/** A fresh code is a 1 in 10^12 draw, so a clash is rare; three draws make one a non-event. */
const CODE_DRAWS = 3;

const summary = (viewer: LeagueViewer, league: LeagueRecord): LeagueSummary => ({
  id: league.id,
  name: league.name,
  owner: league.ownerUserId === viewer.authUserId,
});

export async function listLeagues(
  viewer: LeagueViewer,
  overrides: Partial<LeagueDependencies> = {},
): Promise<LeagueSummary[]> {
  const { store } = deps(overrides);
  return (await store.listFor(viewer.authUserId)).map((league) => summary(viewer, league));
}

export async function createLeague(
  viewer: LeagueViewer,
  name: string,
  overrides: Partial<LeagueDependencies> = {},
): Promise<{ status: "created"; id: string } | { status: "limit" | "unavailable" }> {
  const { store, inviteCode } = deps(overrides);
  for (let draw = 0; draw < CODE_DRAWS; draw += 1) {
    const outcome = await store.create(memberKey(viewer), name, inviteCode());
    if (outcome.status === "created") return { status: "created", id: outcome.leagueId };
    if (outcome.status === "limit") return { status: "limit" };
  }
  return { status: "unavailable" };
}

export async function joinLeague(
  viewer: LeagueViewer,
  code: string,
  overrides: Partial<LeagueDependencies> = {},
): Promise<{ status: "joined"; id: string } | { status: "not_found" | "limit" | "full" }> {
  const outcome = await deps(overrides).store.join(memberKey(viewer), code);
  if (outcome.status === "joined" || outcome.status === "already") return { status: "joined", id: outcome.leagueId };
  return { status: outcome.status };
}

export async function leaveLeague(
  viewer: LeagueViewer,
  leagueId: string,
  overrides: Partial<LeagueDependencies> = {},
): Promise<"left" | "not_found" | "owner"> {
  return deps(overrides).store.leave(leagueId, viewer.authUserId);
}

export async function deleteLeague(
  viewer: LeagueViewer,
  leagueId: string,
  overrides: Partial<LeagueDependencies> = {},
): Promise<boolean> {
  return deps(overrides).store.remove(leagueId, viewer.authUserId);
}

export async function newInviteCode(
  viewer: LeagueViewer,
  leagueId: string,
  overrides: Partial<LeagueDependencies> = {},
): Promise<{ status: "set"; code: string } | { status: "not_found" | "unavailable" }> {
  const { store, inviteCode } = deps(overrides);
  for (let draw = 0; draw < CODE_DRAWS; draw += 1) {
    const code = inviteCode();
    const outcome = await store.setInviteCode(leagueId, viewer.authUserId, code);
    if (outcome === "set") return { status: "set", code };
    if (outcome === "not_found") return { status: "not_found" };
  }
  return { status: "unavailable" };
}

/** Whether the reader may see this member at all. Throws when it cannot tell. */
async function visibleTo(viewer: LeagueViewer, member: ProfileRecord, d: LeagueDependencies): Promise<boolean> {
  if (isProfileTombstoned(member)) return false;
  const pair = await d.relationship(viewer, member);
  if (pair === "blocked") return false;
  if (accountIsPrivate(member.visibility) && pair !== "mutual") return false;
  return !(await d.mutes(viewer, member));
}

/** The league as the reader may see it, or null when it is gone or not theirs. */
export async function readLeague(
  viewer: LeagueViewer,
  leagueId: string,
  overrides: Partial<LeagueDependencies> = {},
): Promise<LeagueBoard | null> {
  const d = deps(overrides);
  const found = await d.store.read(leagueId, viewer.authUserId);
  if (!found) return null;
  const { league, members } = found;

  const others = members.filter((member) => member.userId !== viewer.authUserId);
  const profiles = (await Promise.all(others.map((member) => d.profile(member.profileId))))
    .map((profile, index) => (profile ? { profile, userId: others[index]!.userId } : null))
    .filter((row): row is { profile: ProfileRecord; userId: string } => row !== null);
  const allowed = await Promise.all(profiles.map(({ profile }) => visibleTo(viewer, profile, d)));
  const visible = profiles.filter((_, index) => allowed[index]);
  const hidden = visible.length ? await d.withdrawn(visible.map(({ profile }) => profile.handle)) : new Set<string>();

  const self = await d.profile(viewer.profileId);
  const people = [
    ...(self ? [{ profile: self, userId: viewer.authUserId }] : []),
    ...visible.filter(({ profile }) => !hidden.has(normalizeViewerHandle(profile.handle))),
  ];
  const [standings, districtPubs] = await Promise.all([
    inTurns(people, ({ profile }) => d.standing(profile)),
    d.districtPubs().catch(() => null),
  ]);

  const selfHandle = normalizeViewerHandle(viewer.handle);
  const degraded = standings.some((standing) => standing.status === "degraded");
  const rows: LeagueRow[] = people.map(({ profile, userId }, index) => {
    const handle = normalizeViewerHandle(profile.handle);
    return {
      handle,
      self: handle === selfHandle,
      total: standings[index]!.total,
      level: standings[index]!.level,
      owner: userId === league.ownerUserId,
    };
  });
  return {
    league: { id: league.id, name: league.name, code: league.inviteCode, owner: league.ownerUserId === viewer.authUserId },
    status: degraded ? "degraded" : "ready",
    rows,
    districts: districtPubs && !degraded
      ? leagueDistricts(
        districtPubs,
        rows.map((row, index) => ({ handle: row.handle, self: row.self, visited: standings[index]!.visited })),
      )
      : null,
  };
}
