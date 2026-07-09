import { notFound } from "next/navigation";

import PubMaxingShell from "@/components/PubMaxingShell";
import { getCity, parseCityId } from "@/lib/cities";

type CityMapPageProps = {
  params: Promise<{ city: string }>;
};

export default async function CityMapPage({ params }: CityMapPageProps) {
  const { city: raw } = await params;
  const cityId = parseCityId(raw);
  if (!cityId) notFound();

  const city = getCity(cityId);
  if (!city.enabled) notFound();

  return <PubMaxingShell cityId={cityId} />;
}
