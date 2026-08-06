import "server-only";

import {
  PLAN_ANCHOR_SOURCES,
  PLAN_OUTCOMES,
  PLANNED_NIGHT_STATUSES,
  type CrawlEnding,
  type PlanActionDTO,
  type PlanDTO,
  type PlannedNightStatus,
  type PlanState,
  type PlanStopDTO,
} from "@/lib/plan";
import {
  isBudget,
  isDaypart,
  isNightAreaSlug,
  isPartyType,
  type NightContext,
} from "@/lib/nightPlanning";
import type { SocialRelationshipResolution } from "@/lib/socialRelationships.server";
import {
  isSocialCrewMembershipState,
  isSocialCrewRole,
  isSocialCrewVisibility,
  socialCrewPhase,
  type SocialCrewJoinRequestState,
  type SocialCrewListItemDTO,
  type SocialCrewListPageDTO,
  type SocialCrewMembershipState,
  type SocialCrewPlanDTO,
  type SocialCrewReadDTO,
  type SocialCrewRole,
} from "@/lib/socialCrew";
import type { SocialPostActor } from "@/lib/socialPostStore";

export type RawSocialCrewMember = {
  memberId: string;
  accountId: string;
  profileId: string;
  planMemberId: string;
  handle: string;
  role: SocialCrewRole;
  state: SocialCrewMembershipState;
  joinedAt: string;
};

export type RawSocialCrew = {
  crewId: string;
  planId: string;
  ownerAccountId: string;
  ownerProfileId: string;
  visibility: "private" | "friends";
  authorityRevision: number;
  joinRequestState: "none" | "pending" | "declined";
  members: RawSocialCrewMember[];
};

export type RawSocialCrewListItem = {
  crewId: string;
  title: string;
  status: PlannedNightStatus;
  nightArea: NightContext["nightArea"];
  startsAt: string;
  memberId: string;
  accountId: string;
  profileId: string;
  role: SocialCrewRole;
  state: SocialCrewMembershipState;
  joinedAt: string;
};

export type SocialCrewListCursorPosition = {
  joinedAt: string;
  memberId: string;
};

export type RawSocialCrewListPage = {
  items: RawSocialCrewListItem[];
  hasMore: boolean;
  cursorPosition: SocialCrewListCursorPosition | null;
};

export type SocialCrewListCursorEncoder = (
  position: SocialCrewListCursorPosition,
) => string;

export type SocialCrewProjectionViewer = {
  actor: SocialPostActor;
  ownerRelationship: SocialRelationshipResolution;
  plan: PlanState;
};

type ParsedSocialCrewMember = RawSocialCrewMember & { joinedAt: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const PLAN_ACTION_TYPES = ["arrived", "skipped", "swapped", "ending"] as const;
const CRAWL_ENDINGS = ["food", "get_home", "keep_going"] as const;

function unavailable(section: string): never {
  throw new Error(`Social Crew ${section} data is unavailable.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function canonicalDate(value: unknown, section: string): string {
  if (typeof value !== "string") return unavailable(section);
  const parts = ISO_TIMESTAMP_RE.exec(value);
  if (!parts) return unavailable(section);
  const [, year, month, day, hour, minute, second] = parts.map(Number);
  if (
    month! < 1 ||
    month! > 12 ||
    day! < 1 ||
    day! > new Date(Date.UTC(year!, month!, 0)).getUTCDate() ||
    hour! > 23 ||
    minute! > 59 ||
    second! > 59
  ) {
    return unavailable(section);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return unavailable(section);
  return new Date(timestamp).toISOString();
}

function isPlannedNightStatus(value: unknown): value is PlannedNightStatus {
  return (PLANNED_NIGHT_STATUSES as readonly unknown[]).includes(value);
}

function isCrawlEnding(value: unknown): value is CrawlEnding {
  return (CRAWL_ENDINGS as readonly unknown[]).includes(value);
}

function positiveInteger(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 1 ? value : null;
  }
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function optionalString(
  value: unknown,
  section: string,
): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string" || !value.trim()) return unavailable(section);
  return value;
}

function parsePlan(plan: PlanState["plan"]): PlanDTO {
  if (!isRecord(plan)) return unavailable("Plan");
  if (
    !validUuid(plan.id) ||
    typeof plan.title !== "string" ||
    !plan.title.trim() ||
    !isPlannedNightStatus(plan.status)
  ) {
    return unavailable("Plan");
  }
  const routeRevision = positiveInteger(plan.routeRevision);
  if (routeRevision === null) return unavailable("Plan");

  const anchorVenueId = optionalString(plan.anchorVenueId, "Plan");
  if (
    plan.anchorSource !== undefined &&
    plan.anchorSource !== null &&
    !(PLAN_ANCHOR_SOURCES as readonly unknown[]).includes(plan.anchorSource)
  ) {
    return unavailable("Plan");
  }
  if (
    plan.outcome !== undefined &&
    plan.outcome !== null &&
    !(PLAN_OUTCOMES as readonly unknown[]).includes(plan.outcome)
  ) {
    return unavailable("Plan");
  }
  const routeReadyAt = plan.routeReadyAt === undefined || plan.routeReadyAt === null
    ? plan.routeReadyAt
    : canonicalDate(plan.routeReadyAt, "Plan");

  return {
    id: plan.id,
    title: plan.title,
    startTime: canonicalDate(plan.startTime, "Plan"),
    createdAt: canonicalDate(plan.createdAt, "Plan"),
    routeRevision,
    status: plan.status,
    ...(anchorVenueId !== undefined ? { anchorVenueId } : {}),
    ...(plan.anchorSource !== undefined ? { anchorSource: plan.anchorSource } : {}),
    ...(plan.outcome !== undefined ? { outcome: plan.outcome } : {}),
    ...(routeReadyAt !== undefined ? { routeReadyAt } : {}),
  };
}

function parseStops(value: PlanState["stops"]): PlanStopDTO[] {
  if (!Array.isArray(value)) return unavailable("Plan Stop");
  const positions = new Set<number>();
  const venueIds = new Set<string>();
  return value.map((raw) => {
    if (
      !isRecord(raw) ||
      typeof raw.venueId !== "string" ||
      !raw.venueId.trim() ||
      typeof raw.venueName !== "string" ||
      !raw.venueName.trim() ||
      !Number.isSafeInteger(raw.position) ||
      (raw.position as number) < 0 ||
      positions.has(raw.position as number) ||
      venueIds.has(raw.venueId)
    ) {
      return unavailable("Plan Stop");
    }
    positions.add(raw.position as number);
    venueIds.add(raw.venueId);
    return {
      venueId: raw.venueId,
      venueName: raw.venueName,
      position: raw.position as number,
    };
  });
}

function parseContextList(value: unknown): string[] | never {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || !item.trim())
  ) {
    return unavailable("Plan context");
  }
  return value.map((item) => item as string);
}

function parseContext(value: PlanState["context"]): NightContext | null {
  if (value === null || value === undefined) return null;
  if (
    !isRecord(value) ||
    !(value.nightArea === null || isNightAreaSlug(value.nightArea)) ||
    !isDaypart(value.daypart) ||
    !isPartyType(value.partyType) ||
    !(
      value.groupSize === null ||
      (Number.isSafeInteger(value.groupSize) &&
        (value.groupSize as number) >= 1 &&
        (value.groupSize as number) <= 30)
    ) ||
    !isBudget(value.budget) ||
    !(
      value.budgetLimitPence === null ||
      (Number.isSafeInteger(value.budgetLimitPence) &&
        (value.budgetLimitPence as number) >= 500 &&
        (value.budgetLimitPence as number) <= 50_000)
    ) ||
    typeof value.zeroProof !== "boolean"
  ) {
    return unavailable("Plan context");
  }
  return {
    nightArea: value.nightArea,
    daypart: value.daypart,
    partyType: value.partyType,
    groupSize: value.groupSize as number | null,
    budget: value.budget,
    budgetLimitPence: value.budgetLimitPence as number | null,
    zeroProof: value.zeroProof,
    atmosphere: parseContextList(value.atmosphere),
    foodNeeds: parseContextList(value.foodNeeds),
    accessibility: parseContextList(value.accessibility),
    transportConstraints: parseContextList(value.transportConstraints),
  };
}

function parseActions(
  value: PlanState["actions"],
  stopPositions: ReadonlySet<number>,
): PlanActionDTO[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return unavailable("Plan action");
  const ids = new Set<string>();
  return value.map((raw) => {
    if (
      !isRecord(raw) ||
      typeof raw.id !== "string" ||
      !raw.id.trim() ||
      ids.has(raw.id) ||
      !(PLAN_ACTION_TYPES as readonly unknown[]).includes(raw.type)
    ) {
      return unavailable("Plan action");
    }
    const isEnding = raw.type === "ending";
    if (
      (isEnding && (raw.stopPosition !== null || !isCrawlEnding(raw.ending))) ||
      (!isEnding &&
        (!Number.isSafeInteger(raw.stopPosition) ||
          !stopPositions.has(raw.stopPosition as number) ||
          raw.ending !== null))
    ) {
      return unavailable("Plan action");
    }
    ids.add(raw.id);
    return {
      id: raw.id,
      type: raw.type as PlanActionDTO["type"],
      stopPosition: raw.stopPosition as number | null,
      ending: raw.ending as CrawlEnding | null,
      createdAt: canonicalDate(raw.createdAt, "Plan action"),
    };
  });
}

function parseEnding(value: PlanState["ending"]): CrawlEnding | null {
  if (value === null || value === undefined) return null;
  return isCrawlEnding(value) ? value : unavailable("Plan ending");
}

function parsePlanState(value: PlanState): SocialCrewPlanDTO {
  if (!isRecord(value)) return unavailable("Plan");
  const plan = parsePlan(value.plan as PlanState["plan"]);
  const stops = parseStops(value.stops as PlanState["stops"]);
  const actions = parseActions(
    value.actions as PlanState["actions"],
    new Set(stops.map((stop) => stop.position)),
  );
  const ending = parseEnding(value.ending as PlanState["ending"]);
  const endingActions = actions.filter((action) => action.type === "ending");
  if (
    (ending === null && endingActions.length > 0) ||
    (ending !== null &&
      (endingActions.length !== 1 || endingActions[0]?.ending !== ending))
  ) {
    return unavailable("Plan ending");
  }
  return {
    plan,
    stops,
    context: parseContext(value.context as PlanState["context"]),
    actions,
    ending,
  };
}

function validJoinRequestState(
  value: SocialCrewJoinRequestState | "none",
): value is "none" | "pending" | "declined" {
  return value === "none" || value === "pending" || value === "declined";
}

function parseMembers(value: unknown): ParsedSocialCrewMember[] {
  if (!Array.isArray(value)) return unavailable("member");
  const memberIds = new Set<string>();
  const accountIds = new Set<string>();
  const profileIds = new Set<string>();
  const planMemberIds = new Set<string>();
  return value.map((raw) => {
    if (
      !isRecord(raw) ||
      !isSocialCrewRole(raw.role) ||
      !isSocialCrewMembershipState(raw.state) ||
      !validUuid(raw.memberId) ||
      !validUuid(raw.accountId) ||
      !validUuid(raw.profileId) ||
      !validUuid(raw.planMemberId) ||
      typeof raw.handle !== "string" ||
      !raw.handle.trim() ||
      memberIds.has(raw.memberId) ||
      accountIds.has(raw.accountId) ||
      profileIds.has(raw.profileId) ||
      planMemberIds.has(raw.planMemberId)
    ) {
      return unavailable("member");
    }
    memberIds.add(raw.memberId);
    accountIds.add(raw.accountId);
    profileIds.add(raw.profileId);
    planMemberIds.add(raw.planMemberId);
    return {
      memberId: raw.memberId,
      accountId: raw.accountId,
      profileId: raw.profileId,
      planMemberId: raw.planMemberId,
      handle: raw.handle,
      role: raw.role,
      state: raw.state,
      joinedAt: canonicalDate(raw.joinedAt, "member"),
    };
  });
}

function parseRawSocialCrew(raw: RawSocialCrew): RawSocialCrew & {
  members: ParsedSocialCrewMember[];
} {
  if (
    !isRecord(raw) ||
    !validUuid(raw.crewId) ||
    !validUuid(raw.planId) ||
    !validUuid(raw.ownerAccountId) ||
    !validUuid(raw.ownerProfileId) ||
    !isSocialCrewVisibility(raw.visibility) ||
    !Number.isSafeInteger(raw.authorityRevision) ||
    raw.authorityRevision < 1 ||
    !validJoinRequestState(raw.joinRequestState)
  ) {
    return unavailable("authority");
  }
  return {
    crewId: raw.crewId,
    planId: raw.planId,
    ownerAccountId: raw.ownerAccountId,
    ownerProfileId: raw.ownerProfileId,
    visibility: raw.visibility,
    authorityRevision: raw.authorityRevision,
    joinRequestState: raw.joinRequestState,
    members: parseMembers(raw.members),
  };
}

export function validateRawSocialCrew(raw: RawSocialCrew): void {
  parseRawSocialCrew(raw);
}

export function projectSocialCrewRead(
  rawInput: RawSocialCrew,
  viewer: SocialCrewProjectionViewer,
): SocialCrewReadDTO | null {
  const raw = parseRawSocialCrew(rawInput);
  const planState = parsePlanState(viewer.plan);
  if (planState.plan.id !== raw.planId) return unavailable("Plan");

  const members = raw.members.filter((member) => member.state === "active");
  const owners = members.filter((member) => member.role === "owner");
  const owner = owners.find((member) =>
    member.accountId === raw.ownerAccountId &&
    member.profileId === raw.ownerProfileId
  );
  if (!owner || owners.length !== 1) return unavailable("owner");

  const actorMember = members.find((member) =>
    member.accountId === viewer.actor.accountId &&
    member.profileId === viewer.actor.profileId
  );
  const phase = socialCrewPhase(planState.plan.status as PlannedNightStatus);
  const nightArea = planState.context?.nightArea ?? null;

  if (!actorMember) {
    if (raw.visibility !== "friends" || viewer.ownerRelationship !== "mutual") {
      return null;
    }
    return {
      kind: "preview",
      title: planState.plan.title,
      phase,
      nightArea,
      startsAt: planState.plan.startTime,
      joinRequestState: raw.joinRequestState,
    };
  }

  const ownerIsViewer = actorMember.memberId === owner.memberId;
  if (
    (ownerIsViewer && viewer.ownerRelationship !== "self") ||
    (!ownerIsViewer && viewer.ownerRelationship !== "mutual")
  ) {
    return null;
  }

  return {
    kind: "member",
    crewId: raw.crewId,
    title: planState.plan.title,
    visibility: raw.visibility,
    phase,
    nightArea,
    startsAt: planState.plan.startTime,
    authorityRevision: raw.authorityRevision,
    viewer: { memberId: actorMember.memberId, role: actorMember.role },
    owner: { memberId: owner.memberId, handle: owner.handle },
    members: members.map((member) => ({
      memberId: member.memberId,
      handle: member.handle,
      role: member.role,
      joinedAt: member.joinedAt,
    })),
    plan: planState,
  };
}

function parseListItem(
  value: unknown,
  viewer: SocialPostActor,
): { item: SocialCrewListItemDTO; position: SocialCrewListCursorPosition } {
  if (
    !isRecord(value) ||
    !validUuid(value.crewId) ||
    typeof value.title !== "string" ||
    !value.title.trim() ||
    !isPlannedNightStatus(value.status) ||
    !(value.nightArea === null || isNightAreaSlug(value.nightArea)) ||
    !validUuid(value.memberId) ||
    !validUuid(value.accountId) ||
    !validUuid(value.profileId) ||
    value.accountId !== viewer.accountId ||
    value.profileId !== viewer.profileId ||
    !isSocialCrewRole(value.role) ||
    value.state !== "active"
  ) {
    return unavailable("list");
  }
  const startsAt = canonicalDate(value.startsAt, "list");
  const joinedAt = canonicalDate(value.joinedAt, "list");
  return {
    item: {
      kind: "member",
      crewId: value.crewId,
      title: value.title,
      phase: socialCrewPhase(value.status),
      nightArea: value.nightArea,
      startsAt,
      viewer: { memberId: value.memberId, role: value.role },
    },
    position: { joinedAt, memberId: value.memberId },
  };
}

function positionIsBefore(
  previous: SocialCrewListCursorPosition,
  current: SocialCrewListCursorPosition,
): boolean {
  if (previous.joinedAt !== current.joinedAt) {
    return previous.joinedAt > current.joinedAt;
  }
  return previous.memberId > current.memberId;
}

export function projectSocialCrewListPage(
  raw: RawSocialCrewListPage,
  viewer: SocialPostActor,
  encodeCursor: SocialCrewListCursorEncoder,
): SocialCrewListPageDTO {
  if (
    !isRecord(raw) ||
    !Array.isArray(raw.items) ||
    typeof raw.hasMore !== "boolean" ||
    !validUuid(viewer.accountId) ||
    !validUuid(viewer.profileId)
  ) {
    return unavailable("list");
  }
  const parsed = raw.items.map((item) => parseListItem(item, viewer));
  const crewIds = new Set(parsed.map(({ item }) => item.crewId));
  if (
    crewIds.size !== parsed.length ||
    parsed.some(({ position }, index) =>
      index > 0 && !positionIsBefore(parsed[index - 1]!.position, position)
    )
  ) {
    return unavailable("list");
  }

  if (!raw.hasMore) {
    if (raw.cursorPosition !== null) return unavailable("list");
    return { items: parsed.map(({ item }) => item), nextCursor: null };
  }
  if (!isRecord(raw.cursorPosition) || parsed.length === 0) {
    return unavailable("list");
  }
  const cursorPosition = {
    joinedAt: canonicalDate(raw.cursorPosition.joinedAt, "list"),
    memberId: validUuid(raw.cursorPosition.memberId)
      ? raw.cursorPosition.memberId
      : unavailable("list"),
  };
  const lastPosition = parsed.at(-1)!.position;
  if (
    cursorPosition.joinedAt !== lastPosition.joinedAt ||
    cursorPosition.memberId !== lastPosition.memberId
  ) {
    return unavailable("list");
  }
  const nextCursor = encodeCursor(cursorPosition);
  if (typeof nextCursor !== "string" || !nextCursor) return unavailable("list");
  return { items: parsed.map(({ item }) => item), nextCursor };
}
