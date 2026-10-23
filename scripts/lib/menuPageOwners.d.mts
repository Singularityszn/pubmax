export const MENU_OWNER_MAX_METRES: number;

export type MenuPageOwner = {
  osmId: string;
  name: string;
  lat: number;
  lng: number;
  source: "osm" | "google-places";
};

export type MenuPageOwners = Map<string, MenuPageOwner[]>;

export type MenuOwnerVerdict =
  | { verdict: "owner-unknown" }
  | { verdict: "same-pub" | "other-pub"; owner: MenuPageOwner; metres: number };

export function menuPageKey(url: string): string | null;

export function venueKeyPoint(venueKey: string): { lat: number; lng: number } | null;

export function buildMenuPageOwners(input: {
  osmPubs: Array<{ osmId: string; name: string; lat: number; lng: number; website?: string | null }>;
  placesVenues?: Array<{ venueId: string; websiteUri?: { value?: string } | null }>;
}): MenuPageOwners;

export function readMenuPageOwners(root: string): MenuPageOwners;

export function menuOwnerVerdict(
  pageUrl: string | null | undefined,
  point: { lat: number; lng: number } | null,
  owners: MenuPageOwners,
): MenuOwnerVerdict;
