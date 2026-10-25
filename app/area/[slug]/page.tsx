import { notFound, permanentRedirect } from "next/navigation";

import { mapAreaHref } from "@/lib/mapAreaArrival";
import { getNightAreasForCity } from "@/lib/nightAreas";
import { slugifyVenueName } from "@/lib/venuePermalinkSlug";

// Area roots are redirects, so they never compete with the borough pages.
export default async function AreaPage({ params }: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const matches = getNightAreasForCity("london").filter((area) =>
    area.slug === slug || [area.name, ...area.aliases].some((name) => slugifyVenueName(name) === slug),
  );
  if (matches.length !== 1) notFound();
  permanentRedirect(mapAreaHref(matches[0]!));
}
