import { isNightAreaRouteReady, NIGHT_AREAS, type NightArea } from "@/lib/nightAreas";

export type NightAreaSelectorGroup = {
  label: "Crawl-ready" | "Not crawl-ready yet";
  disabled: boolean;
  areas: NightArea[];
};

export function nightAreaSelectorGroups(now = new Date()): NightAreaSelectorGroup[] {
  return [
    {
      label: "Crawl-ready",
      disabled: false,
      areas: NIGHT_AREAS.filter((area) => isNightAreaRouteReady(area, now)),
    },
    {
      label: "Not crawl-ready yet",
      disabled: false,
      areas: NIGHT_AREAS.filter((area) => !isNightAreaRouteReady(area, now)),
    },
  ];
}

export function nightAreaOptionLabel(area: NightArea, disabled: boolean): string {
  return disabled || !isNightAreaRouteReady(area) ? `${area.name}, not crawl-ready yet` : area.name;
}
