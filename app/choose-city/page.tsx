import type { Metadata } from "next";
import { headers } from "next/headers";

import CityChooser from "@/components/city/CityChooser";
import JsonLd from "@/components/seo/JsonLd";
import { cityCoverageItemList } from "@/lib/cityCoverageDisclosure";
import { listEnabledCities } from "@/lib/cities";
import { firstSearchParam } from "@/lib/cityShare";

type ChooseCityPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const cities = listEnabledCities();

export const metadata: Metadata = {
  title: "UK pub maps by city",
  description: `Browse ${cities.length} UK city pub maps. London has dated Pint Prices; every city guide says which crawls and planning tools are ready.`,
  alternates: { canonical: "/choose-city" },
};

export default async function ChooseCityPage({
  searchParams,
}: ChooseCityPageProps) {
  const sp = searchParams ? await searchParams : undefined;
  const focusSearch = firstSearchParam(sp?.focus) === "search";
  const itemList = cityCoverageItemList(cities);
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <>
      <JsonLd data={itemList} nonce={nonce} />
      <CityChooser variant="page" focusSearch={focusSearch} />
    </>
  );
}
