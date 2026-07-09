import { buildCityRivalrySnapshot } from "@/lib/cityRivalry";

import DiscoverPageClient from "./DiscoverPageClient";

export default function DiscoverPage() {
  const rivalry = buildCityRivalrySnapshot();
  return <DiscoverPageClient rivalry={rivalry} />;
}
