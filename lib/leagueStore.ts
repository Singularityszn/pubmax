import "server-only";

// Leagues and who is in them (migration 0239). Process memory runs keyless;
// Supabase is the durable store. The limits and the one-write create and join
// live in the database functions; the memory store keeps the same rules.
//
// Before 0239 is applied the tables are missing, and every call throws
// LeagueStoreError("NOT_OPEN"), so the pages say leagues are not open yet
// rather than keep a league in memory that the next cold start forgets.

import { LEAGUE_MAX_MEMBERS, LEAGUE_MAX_PER_PERSON, type LeagueExportRecord } from "@/lib/leagues";
import { admin, createDualBackendStore, isMissingTableSchema, isUniqueViolation } from "@/lib/storeBackend";

export class LeagueStoreError extends Error {
  constructor(public readonly code: "NOT_OPEN") {
    super("Leagues are not open yet");
    this.name = "LeagueStoreError";
  }
}

/** One account, as a league stores it. */
type LeagueMemberKey = { userId: string; profileId: string };

export type LeagueRecord = {
  id: string;
  name: string;
  ownerUserId: string;
  inviteCode: string;
  createdAt: string;
};

type LeagueMemberRecord = LeagueMemberKey & { joinedAt: string };

type LeagueCreateOutcome =
  | { status: "created"; leagueId: string }
  | { status: "limit" | "code_taken" };

type LeagueJoinOutcome =
  | { status: "joined" | "already"; leagueId: string }
  | { status: "not_found" | "limit" | "full" };

export type LeagueStore = {
  exportFor(userId: string): Promise<LeagueExportRecord[]>;
  create(member: LeagueMemberKey, name: string, inviteCode: string): Promise<LeagueCreateOutcome>;
  join(member: LeagueMemberKey, inviteCode: string): Promise<LeagueJoinOutcome>;
  /** The leagues one account is in, newest joined first. */
  listFor(userId: string): Promise<LeagueRecord[]>;
  /** The league and its members, or null when it is gone or `userId` is not in it. */
  read(leagueId: string, userId: string): Promise<{ league: LeagueRecord; members: LeagueMemberRecord[] } | null>;
  /** The owner cannot leave; they delete the league instead. */
  leave(leagueId: string, userId: string): Promise<"left" | "not_found" | "owner">;
  /** Deletes a league its owner names. False when it is not theirs. */
  remove(leagueId: string, ownerUserId: string): Promise<boolean>;
  setInviteCode(leagueId: string, ownerUserId: string, inviteCode: string): Promise<"set" | "not_found" | "code_taken">;
};

export function createMemoryLeagueStore(options: { now?: () => Date } = {}): LeagueStore {
  const now = options.now ?? (() => new Date());
  const leagues = new Map<string, LeagueRecord>();
  const members = new Map<string, LeagueMemberRecord[]>();
  const membersOf = (leagueId: string) => members.get(leagueId) ?? [];
  const countFor = (userId: string) =>
    [...members.values()].filter((list) => list.some((member) => member.userId === userId)).length;
  const codeTaken = (code: string) => [...leagues.values()].some((league) => league.inviteCode === code);

  return {
    async exportFor(userId) {
      const owned: LeagueExportRecord[] = [...leagues.values()]
        .filter((league) => league.ownerUserId === userId)
        .map(({ name, createdAt }) => ({ kind: "owned", name, createdAt }));
      const memberships: LeagueExportRecord[] = [...leagues.values()].flatMap((league) => {
        const member = membersOf(league.id).find((row) => row.userId === userId);
        return member ? [{ kind: "membership" as const, name: league.name, joinedAt: member.joinedAt }] : [];
      });
      return [...owned, ...memberships];
    },
    async create(member, name, inviteCode) {
      if (countFor(member.userId) >= LEAGUE_MAX_PER_PERSON) return { status: "limit" };
      if (codeTaken(inviteCode)) return { status: "code_taken" };
      const createdAt = now().toISOString();
      const league = { id: crypto.randomUUID(), name, ownerUserId: member.userId, inviteCode, createdAt };
      leagues.set(league.id, league);
      members.set(league.id, [{ ...member, joinedAt: createdAt }]);
      return { status: "created", leagueId: league.id };
    },
    async join(member, inviteCode) {
      const league = [...leagues.values()].find((row) => row.inviteCode === inviteCode);
      if (!league) return { status: "not_found" };
      const list = membersOf(league.id);
      if (list.some((row) => row.userId === member.userId)) return { status: "already", leagueId: league.id };
      if (countFor(member.userId) >= LEAGUE_MAX_PER_PERSON) return { status: "limit" };
      if (list.length >= LEAGUE_MAX_MEMBERS) return { status: "full" };
      members.set(league.id, [...list, { ...member, joinedAt: now().toISOString() }]);
      return { status: "joined", leagueId: league.id };
    },
    async listFor(userId) {
      return [...leagues.values()]
        .map((league) => ({ league, joinedAt: membersOf(league.id).find((row) => row.userId === userId)?.joinedAt }))
        .filter((row): row is { league: LeagueRecord; joinedAt: string } => row.joinedAt !== undefined)
        .sort((a, b) => b.joinedAt.localeCompare(a.joinedAt))
        .map(({ league }) => ({ ...league }));
    },
    async read(leagueId, userId) {
      const league = leagues.get(leagueId);
      const list = membersOf(leagueId);
      if (!league || !list.some((row) => row.userId === userId)) return null;
      return { league: { ...league }, members: list.map((row) => ({ ...row })) };
    },
    async leave(leagueId, userId) {
      const league = leagues.get(leagueId);
      const list = membersOf(leagueId);
      if (!league || !list.some((row) => row.userId === userId)) return "not_found";
      if (league.ownerUserId === userId) return "owner";
      members.set(leagueId, list.filter((row) => row.userId !== userId));
      return "left";
    },
    async remove(leagueId, ownerUserId) {
      if (leagues.get(leagueId)?.ownerUserId !== ownerUserId) return false;
      leagues.delete(leagueId);
      members.delete(leagueId);
      return true;
    },
    async setInviteCode(leagueId, ownerUserId, inviteCode) {
      const league = leagues.get(leagueId);
      if (league?.ownerUserId !== ownerUserId) return "not_found";
      if (codeTaken(inviteCode)) return "code_taken";
      leagues.set(leagueId, { ...league, inviteCode });
      return "set";
    },
  };
}

const memoryLeagueStore = createMemoryLeagueStore();

type DbError = { code?: string; message?: string };

/** PostgREST and PostgreSQL say a function is missing (PGRST202, 42883) or a table is (PGRST205, 42P01). */
const MISSING_SCHEMA_CODES = new Set(["PGRST202", "42883", "PGRST205", "42P01"]);

/** Throws the error, as NOT_OPEN when the 0239 tables or functions are missing. */
function fail(error: DbError): never {
  const missingFunction = /could not find the function public\.(create_league|join_league)/i.test(error.message ?? "");
  if (
    MISSING_SCHEMA_CODES.has(error.code ?? "") ||
    missingFunction ||
    isMissingTableSchema(new Error(error.message ?? ""), ["leagues", "league_members"])
  ) {
    throw new LeagueStoreError("NOT_OPEN");
  }
  throw new Error(error.message ?? "League store failed");
}

const LEAGUE_COLUMNS = "id, name, owner_user_id, invite_code, created_at";

type LeagueRow = { id: string; name: string; owner_user_id: string; invite_code: string; created_at: string };

const fromRow = (row: LeagueRow): LeagueRecord => ({
  id: row.id,
  name: row.name,
  ownerUserId: row.owner_user_id,
  inviteCode: row.invite_code,
  createdAt: row.created_at,
});

function rpcAnswer(data: unknown): { code: string; leagueId: string | null } {
  const body = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  return {
    code: typeof body.code === "string" ? body.code : "",
    leagueId: typeof body.league_id === "string" ? body.league_id : null,
  };
}

const supabaseLeagueStore: LeagueStore = {
  async exportFor(userId) {
    const [owned, memberships] = await Promise.all([
      admin().from("leagues").select("name, created_at").eq("owner_user_id", userId)
        .order("created_at", { ascending: true }).limit(LEAGUE_MAX_PER_PERSON),
      admin().from("league_members").select("joined_at, leagues!inner(name)").eq("user_id", userId)
        .order("joined_at", { ascending: true }).limit(LEAGUE_MAX_PER_PERSON),
    ]);
    if (owned.error) fail(owned.error);
    if (memberships.error) fail(memberships.error);
    const records: LeagueExportRecord[] = (owned.data ?? []).map((row) => ({
      kind: "owned", name: row.name, createdAt: row.created_at,
    }));
    for (const row of memberships.data ?? []) {
      const league = Array.isArray(row.leagues) ? row.leagues[0] : row.leagues;
      if (!league) throw new Error("League membership export unavailable");
      records.push({ kind: "membership", name: league.name, joinedAt: row.joined_at });
    }
    return records;
  },
  async create(member, name, inviteCode) {
    const { data, error } = await admin().rpc("create_league", {
      p_user_id: member.userId,
      p_profile_id: member.profileId,
      p_name: name,
      p_invite_code: inviteCode,
    });
    if (error) fail(error);
    const answer = rpcAnswer(data);
    if (answer.code === "created" && answer.leagueId) return { status: "created", leagueId: answer.leagueId };
    if (answer.code === "limit" || answer.code === "code_taken") return { status: answer.code };
    throw new Error(`create_league answered ${answer.code || "nothing"}`);
  },
  async join(member, inviteCode) {
    const { data, error } = await admin().rpc("join_league", {
      p_user_id: member.userId,
      p_profile_id: member.profileId,
      p_invite_code: inviteCode,
    });
    if (error) fail(error);
    const answer = rpcAnswer(data);
    if ((answer.code === "joined" || answer.code === "already") && answer.leagueId) {
      return { status: answer.code, leagueId: answer.leagueId };
    }
    if (answer.code === "not_found" || answer.code === "limit" || answer.code === "full") return { status: answer.code };
    throw new Error(`join_league answered ${answer.code || "nothing"}`);
  },
  async listFor(userId) {
    const { data, error } = await admin()
      .from("league_members")
      .select(`joined_at, leagues!inner(${LEAGUE_COLUMNS})`)
      .eq("user_id", userId)
      .order("joined_at", { ascending: false })
      .limit(LEAGUE_MAX_PER_PERSON);
    if (error) fail(error);
    // PostgREST embeds the one league a membership names; the generated type
    // cannot tell one from many, so take the first either way.
    return (data ?? []).flatMap((row) => {
      const embedded: unknown = row.leagues;
      const league = (Array.isArray(embedded) ? embedded[0] : embedded) as LeagueRow | undefined;
      return league ? [fromRow(league)] : [];
    });
  },
  async read(leagueId, userId) {
    const [league, list] = await Promise.all([
      admin().from("leagues").select(LEAGUE_COLUMNS).eq("id", leagueId).maybeSingle(),
      admin()
        .from("league_members")
        .select("user_id, profile_id, joined_at")
        .eq("league_id", leagueId)
        .order("joined_at", { ascending: true })
        .limit(LEAGUE_MAX_MEMBERS),
    ]);
    if (league.error) fail(league.error);
    if (list.error) fail(list.error);
    const rows = (list.data ?? []).map((row) => ({
      userId: row.user_id,
      profileId: row.profile_id,
      joinedAt: row.joined_at,
    }));
    if (!league.data || !rows.some((row) => row.userId === userId)) return null;
    return { league: fromRow(league.data), members: rows };
  },
  async leave(leagueId, userId) {
    const league = await admin().from("leagues").select("owner_user_id").eq("id", leagueId).maybeSingle();
    if (league.error) fail(league.error);
    if (!league.data) return "not_found";
    if (league.data.owner_user_id === userId) return "owner";
    const { data, error } = await admin()
      .from("league_members")
      .delete()
      .eq("league_id", leagueId)
      .eq("user_id", userId)
      .select("user_id");
    if (error) fail(error);
    return (data ?? []).length > 0 ? "left" : "not_found";
  },
  async remove(leagueId, ownerUserId) {
    const { data, error } = await admin()
      .from("leagues")
      .delete()
      .eq("id", leagueId)
      .eq("owner_user_id", ownerUserId)
      .select("id");
    if (error) fail(error);
    return (data ?? []).length > 0;
  },
  async setInviteCode(leagueId, ownerUserId, inviteCode) {
    const { data, error } = await admin()
      .from("leagues")
      .update({ invite_code: inviteCode })
      .eq("id", leagueId)
      .eq("owner_user_id", ownerUserId)
      .select("id");
    if (error) {
      if (isUniqueViolation(error)) return "code_taken";
      fail(error);
    }
    return (data ?? []).length > 0 ? "set" : "not_found";
  },
};

export const leagueStore = createDualBackendStore(memoryLeagueStore, supabaseLeagueStore);
