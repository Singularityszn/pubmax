import { CalendarClock, Coins, Images, Map, Route, UserRound, type LucideIcon } from "lucide-react";

import type { PrimaryNavKey } from "@/components/nav/navigationModel";

/**
 * The one icon each primary door wears, for every bar that draws one: the
 * phone dock (MobileTabBar) and the desktop SiteNav from 1024px. Two bars that
 * name a door the same (navigationModel) draw it the same too. Spoons, the
 * published value ranking, is a desktop door only, so only SiteNav draws its
 * coins.
 */
const NAV_ICONS: Record<PrimaryNavKey, LucideIcon> = {
  map: Map,
  now: CalendarClock,
  plan: Route,
  spoons: Coins,
  social: Images,
  you: UserRound,
};

export function navIcon(key: PrimaryNavKey): LucideIcon {
  return NAV_ICONS[key];
}
