import { getCityCapabilityProfile } from "@/lib/cityCapabilities";
import type { CityConfig } from "@/lib/cities";
import { cityMapShareUrl } from "@/lib/cityShare";

const SITE_URL = "https://pubmaxxing.com";

export type CityCoverageDisclosure = Readonly<{
  available: readonly string[];
  needed: readonly string[];
}>;

export function cityCoverageDisclosure(
  rawCityId: string | null | undefined,
): CityCoverageDisclosure {
  const profile = getCityCapabilityProfile(rawCityId);
  const available: string[] = [];
  const needed: string[] = [];

  if (profile.map.availability === "available") available.push("Listed pubs");

  if (profile.prices.availability === "available") {
    available.push("Dated Pint Prices");
  } else {
    needed.push("Pint Prices");
  }

  if (profile.routes.availability === "available") {
    available.push("Crawls");
  } else {
    needed.push("Crawls");
  }

  if (profile.events.availability === "available") available.push("Tonight");
  if (profile.transport.availability === "available")
    available.push("Get home");

  return { available, needed };
}

export function cityCoverageItemList(cities: readonly CityConfig[]) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "PUBMAXX city pub maps",
    numberOfItems: cities.length,
    itemListElement: cities.map((city, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: `${city.displayName} pub map`,
      url: new URL(cityMapShareUrl(city.id), SITE_URL).toString(),
    })),
  } as const;
}
