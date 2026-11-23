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

/**
 * The gate splits the Area picker only while some areas pass it and some do
 * not. Until an area earns a review (`coverage()` in lib/nightAreas.ts has no
 * review source), a heading, a suffix and a note would say the same of every
 * area, so the picker lists plain names.
 */
export function nightAreaPickerSplits(groups: readonly NightAreaSelectorGroup[]): boolean {
  return groups.every((group) => group.areas.length > 0);
}

export function nightAreaOptionLabel(area: NightArea, disabled: boolean, split: boolean): string {
  return split && (disabled || !isNightAreaRouteReady(area)) ? `${area.name}, not crawl-ready yet` : area.name;
}
