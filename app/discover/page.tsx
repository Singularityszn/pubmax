import { buildCityRivalrySnapshot } from "@/lib/cityRivalry";

import DiscoverPageClient from "./DiscoverPageClient";
export { DISCOVER_EDITORIAL } from "./editorial";

export default function DiscoverPage() {
  const rivalry = buildCityRivalrySnapshot();
  return <DiscoverPageClient rivalry={rivalry} />;
}
