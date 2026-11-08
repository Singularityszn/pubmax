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
import { venueListedPint, type VenueListedPint } from "@/lib/venueListedPint";
import { venueAreaClaim } from "@/lib/venueTruth";

/**
 * The open crawl a link preview describes, plus the map point the public page
 * draws. `missing` is a crew that is not open, not upcoming, or not there;
 * `unavailable` is a read that could not run, or Social switched off.
 */
export type OpenCrawlShareCardResult =
  | { ok: true; card: OpenCrawlShareCard; meetingPoint: OutOpenPlanMeetingPoint }
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

/**
 * Min-max listed pint price over the plan's stops. The stop list is read here
 * and goes no further: only the band leaves this function. A stop with no
 * listed price, or a fallback source with no stop list, prints no band.
 */
async function shareSpendBand(
  source: SocialCrewShareCardSource,
  priceOf: Dependencies["listedPint"],
): Promise<OpenCrawlShareSpendBand | null> {
  if (!source.stopVenueIds || source.stopVenueIds.length === 0) return null;
  try {
    const prices = await Promise.all(source.stopVenueIds.map((venueId) => priceOf(venueId)));
    const range = planInviteSpendBandFromListedPrices(prices.map((price) => price?.priceGbp));
    const observedOn = oldestPintRead(prices.map((price) => price?.publisher ? price.observedOn : null));
    const band = { ...range, observedOn, sourceKind: "listed" };
    return isOpenCrawlShareSpendBand(band) ? band : null;
  } catch {
    return null;
  }
}

function placesLeft(source: SocialCrewShareCardSource): number | null {
  if (source.capacity === null || source.memberCount === null) return null;
  return Math.max(0, source.capacity - source.memberCount);
}

export async function loadOpenCrawlShareCard(
  crewId: string,
  dependencies: Dependencies = DEFAULTS,
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
      spendBand: await shareSpendBand(source, dependencies.listedPint),
    },
  };
}
