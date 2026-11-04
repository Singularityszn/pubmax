export const THIRD_PARTY_SITE_HOSTS: RegExp;

export const PUB_SITE_MENU_PAGES: number;

export function permittedPubSite(
  website: unknown,
): { url: string; host: string; origin: string } | null;

export type PubSiteTarget = {
  venueId: string;
  osmId: string | null;
  name: string | null;
  postcode: string | null;
  lat: number | null;
  lng: number | null;
  locality: string | null;
  address: string | null;
  host: string;
  homeUrl: string;
  origin: string;
};

export function singlePubSiteTargets(
  pubs: ReadonlyArray<{
    osmId?: string;
    name?: string;
    postcode?: string;
    lat?: number;
    lng?: number;
    website?: string;
    locality?: string | null;
    address?: string | null;
  }>,
  options?: { only?: string[] | null },
): PubSiteTarget[];

export function renderedMenuLinks(
  links: ReadonlyArray<string | { href?: string; url?: string }> | unknown,
  homeUrl: string,
  max?: number,
): string[];
