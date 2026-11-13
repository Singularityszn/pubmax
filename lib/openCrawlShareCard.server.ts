import "server-only";

import { getNightAreasForCity } from "@/lib/nightAreas";
import { resolveOpenMeetingPoint } from "@/lib/openSocialCrew.server";
import {
  isOpenCrawlShareSpendBand,
  type OpenCrawlShareArea,
  type OpenCrawlShareCard,
  type OpenCrawlShareSpendBand,
} from "@/lib/openCrawlShareCard";
import { oldestPintRead } from "@/lib/drinks";
import {
  stillTrueListedPint,
  stillTrueSaidYesCount,
  stillTrueVenueId,
  type StillTruePublicFacts,
} from "@/lib/openCrawl";
import type { OutOpenPlanMeetingPoint } from "@/lib/out";
import { planInviteSpendBandFromListedPrices } from "@/lib/shareArtifacts";
import {
  createSocialCrewStore,
  SocialCrewStoreError,
  type SocialCrewStore,
} from "@/lib/socialCrewStore";
import type { SocialCrewShareCardSource } from "@/lib/socialCrew";
import { isSocialFriendsLaunchEnabled, SOCIAL_FRIENDS_LAUNCH_ENV } from "@/lib/socialLaunch";
import { lookupVenueDetail } from "@/lib/venueDetailIndex";
import { requireDynamicSupabaseAdmin } from "@/lib/supabase";
import { venueListedPint, type VenueListedPint } from "@/lib/venueListedPint";
import { venueAreaClaim } from "@/lib/venueTruth";

/**
 * The open crawl a link preview describes, plus the map point the public page
 * draws. `missing` is a crew that is not open, not upcoming, or not there;
 * `unavailable` is a read that could not run, or Social switched off.
 */
export type OpenCrawlShareCardResult =
  | {
      ok: true;
      card: OpenCrawlShareCard;
      meetingPoint: OutOpenPlanMeetingPoint;
      stillTrue: StillTruePublicFacts | null;
    }
  | { ok: false; reason: "missing" | "unavailable" };

type Dependencies = {
  store: Pick<SocialCrewStore, "readShareCard">;
  enabled: () => boolean;
  resolveMeetingPoint: typeof resolveOpenMeetingPoint;
  listedPint: (venueId: string) => Promise<VenueListedPint | null>;
};

async function listedPint(venueId: string): Promise<VenueListedPint | null> {
  const lookup = await lookupVenueDetail(venueId);
  if (lookup.status !== "found") return null;
  return venueListedPint(lookup.venue);
}

let defaultStore: SocialCrewStore | null = null;

const DEFAULTS: Dependencies = {
  get store() {
    defaultStore ??= createSocialCrewStore();
    return defaultStore;
  },
  enabled: () => isSocialFriendsLaunchEnabled(process.env[SOCIAL_FRIENDS_LAUNCH_ENV]),
  resolveMeetingPoint: resolveOpenMeetingPoint,
  listedPint,
};

/** The area a stranger is told about: the claim's strength decides "in" or "near". */
function shareArea(
  cityId: Parameters<typeof getNightAreasForCity>[0],
  point: { lng: number; lat: number },
): OpenCrawlShareArea | null {
  const areas = getNightAreasForCity(cityId);
  const claim = venueAreaClaim({ longitude: point.lng, latitude: point.lat }, areas);
  if (claim.relation === "unplaced") return null;
  const area = areas.find((candidate) => candidate.slug === claim.area.slug);
  return area ? { name: area.name, relation: claim.relation } : null;
}

function shareSpendBand(
  prices: readonly (VenueListedPint | null)[],
): OpenCrawlShareSpendBand | null {
  if (prices.length === 0) return null;
  const range = planInviteSpendBandFromListedPrices(prices.map((price) => price?.priceGbp));
  const observedOn = oldestPintRead(prices.map((price) => price?.publisher ? price.observedOn : null));
  const band = { ...range, observedOn, sourceKind: "listed" };
  return isOpenCrawlShareSpendBand(band) ? band : null;
}

function placesLeft(source: SocialCrewShareCardSource): number | null {
  if (source.capacity === null || source.memberCount === null) return null;
  return Math.max(0, source.capacity - source.memberCount);
}

type CountRow = Record<string, unknown>;

function textIds(rows: readonly CountRow[], key: string): string[] {
  return rows.flatMap((row) => (typeof row[key] === "string" ? [row[key]] : []));
}

/**
 * Live pending join rows, plus active seats that are not the host. Here is a status
 * on those seats, including the host. A failed read is null, not zero.
 * Read requests before seats so acceptance between the reads cannot omit a
 * person from both. stillTrueSaidYesCount removes overlap between the reads.
 */
export const stillTrueCountReader = {
  async read(crewId: string): Promise<{ saidYes: number; markedHere: number | null } | null> {
    try {
      const admin = requireDynamicSupabaseAdmin();
      const pending = await admin
        .from("social_crew_join_requests")
        .select("requester_account_id")
        .eq("crew_id", crewId)
        .eq("state", "pending")
        // Expiry is recorded lazily, so a stale request can still read pending.
        .gt("expires_at", new Date().toISOString());
      const members = await admin
        .from("social_crew_members")
        .select("social_account_id, plan_member_id, role")
        .eq("crew_id", crewId)
        .eq("state", "active");
      if (pending.error || members.error || !pending.data || !members.data) return null;
      const memberRows = members.data as CountRow[];
      const saidYes = stillTrueSaidYesCount(
        textIds(pending.data as CountRow[], "requester_account_id"),
        textIds(memberRows.filter((row) => row.role !== "owner"), "social_account_id"),
      );
      const seatIds = textIds(memberRows, "plan_member_id");
      if (seatIds.length === 0) return { saidYes, markedHere: 0 };
      const here = await admin
        .from("plan_crew_members")
        .select("id")
        .in("id", seatIds)
        .eq("status", "here");
      if (here.error || !here.data) return { saidYes, markedHere: null };
      return { saidYes, markedHere: here.data.length };
    } catch {
      return null;
    }
  },
};

async function stillTrueFacts(
  source: SocialCrewShareCardSource,
  price: VenueListedPint | null,
): Promise<StillTruePublicFacts | null> {
  if (!stillTrueVenueId(source.stopVenueIds)) return null;
  const counts = await stillTrueCountReader.read(source.crewId);
  return {
    saidYes: counts?.saidYes ?? null,
    markedHere: counts ? counts.markedHere : null,
    listedPint: stillTrueListedPint(price),
  };
}

export async function loadOpenCrawlShareCard(
  crewId: string,
  dependencies: Dependencies = DEFAULTS,
): Promise<OpenCrawlShareCardResult> {
  return loadOpenCrawl(crewId, dependencies, false);
}

export async function loadOpenCrawlPublicPreview(crewId: string): Promise<OpenCrawlShareCardResult> {
  return loadOpenCrawl(crewId, DEFAULTS, true);
}

async function loadOpenCrawl(
  crewId: string,
  dependencies: Dependencies,
  includeStillTrue: boolean,
): Promise<OpenCrawlShareCardResult> {
  if (!dependencies.enabled()) return { ok: false, reason: "unavailable" };
  let source: SocialCrewShareCardSource;
  try {
    source = await dependencies.store.readShareCard(crewId);
  } catch (error) {
    if (error instanceof SocialCrewStoreError && error.code === "NOT_FOUND") {
      return { ok: false, reason: "missing" };
    }
    return { ok: false, reason: "unavailable" };
  }
  const resolution = await dependencies.resolveMeetingPoint(source.meetingVenueId);
  if (!resolution.ok) {
    return { ok: false, reason: resolution.reason === "unavailable" ? "unavailable" : "missing" };
  }
  const { cityId, ...meetingPoint } = resolution.meetingPoint;
  let prices: (VenueListedPint | null)[];
  try {
    prices = await Promise.all(
      (source.stopVenueIds ?? []).map((venueId) => dependencies.listedPint(venueId)),
    );
  } catch {
    prices = [];
  }
  return {
    ok: true,
    meetingPoint,
    card: {
      crewId: source.crewId,
      title: source.title,
      hostHandle: source.hostHandle,
      startsAt: source.startsAt,
      meetingPubName: meetingPoint.name,
      area: shareArea(cityId, meetingPoint),
      placesLeft: placesLeft(source),
      spendBand: shareSpendBand(prices),
    },
    stillTrue: includeStillTrue ? await stillTrueFacts(source, prices[0] ?? null) : null,
  };
}
