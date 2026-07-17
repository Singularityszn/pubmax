"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Map, CirclePlus, UserRound, Images, CalendarClock } from "lucide-react";
import { useCallback, useSyncExternalStore, type CSSProperties } from "react";
import {
  preferredCityMapHref,
  subscribePreferredCity,
} from "@/lib/cityPreference";
import { warmMapRoute } from "@/lib/mapWarmup";
import { markPubmaxTiming } from "@/lib/performanceMarks";
import { MOMENT_NAV_ACTION, PRIMARY_NAV_ITEMS, momentHref, type PrimaryNavKey } from "@/components/nav/navigationModel";
import "./mobileNav.css";

// Mobile-first bottom tab bar. Visible only ≤640px (see mobileNav.css); on
// desktop it is display:none so the existing desktop navs are untouched.
//
// Moment is the emphasized centre action and opens the private-first camera
// composer. Pint Drop remains an explicit action inside Moment and the map.
//
// No effects: usePathname() is enough to mark the active tab, which keeps this
// clear of react-hooks/set-state-in-effect.

type Tab = {
  key: PrimaryNavKey | typeof MOMENT_NAV_ACTION.key;
  href: string;
  label: string;
  Icon: typeof Map;
  /** Path prefixes that should mark this tab active (defaults to href). */
  match?: string[];
  /** The emphasized centre action. */
  primary?: boolean;
};

const warmedTabs = new Set<string>();

// Map follows the preferred city (null → /map); every other route is canonical.
function buildTabs(mapHref: string, pathname: string): Tab[] {
  const icons = { map: Map, tonight: CalendarClock, moment: CirclePlus, stories: Images, you: UserRound };
  const destinations = PRIMARY_NAV_ITEMS.map((item) => ({
    ...item,
    href: item.key === "map" ? mapHref : item.href,
    Icon: icons[item.key],
  }));
  return [
    ...destinations.slice(0, 2),
    { ...MOMENT_NAV_ACTION, href: momentHref(pathname), match: [], Icon: icons.moment, primary: true },
    ...destinations.slice(2),
  ];
}

function isActive(pathname: string, tab: Tab): boolean {
  // The primary Moment action is intentionally not painted as a persistent
  // active tab; its raised shape communicates creation rather than location.
  if (tab.primary) return false;
  const prefixes = tab.match ?? [tab.href];
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export default function MobileTabBar() {
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const router = useRouter();
  // Preference may be null → /map. useSyncExternalStore: SSR/hydration stay on
  // /map, then re-read after mount (and when CitySwitcher writes).
  const mapHref = useSyncExternalStore(
    subscribePreferredCity,
    preferredCityMapHref,
    () => "/map",
  );
  const returnTo = `${pathname}${searchParams.size ? `?${searchParams.toString()}` : ""}`;
  const tabs = buildTabs(mapHref, returnTo);
  // Drives the gliding highlight pill (mobileNav.css). -1 (no match — e.g. a
  // route none of the five tabs own) hides it via CSS rather than pinning it
  // to a wrong tab.
  const activeIndex = tabs.findIndex((tab) => isActive(pathname, tab));
  const warmTab = useCallback(
    (href: string) => {
      const prefetchHref = href.split("?")[0] || href;
      if (prefetchHref === "/map" || prefetchHref.startsWith("/map/")) {
        warmMapRoute(router, href, warmedTabs);
        return;
      }
      if (warmedTabs.has(prefetchHref)) return;
      warmedTabs.add(prefetchHref);
      router.prefetch(prefetchHref);
    },
    [router],
  );
  const markDropTap = useCallback((primary?: boolean) => {
    if (primary) markPubmaxTiming("pubmax:drop-tap");
  }, []);

  return (
    <nav className="mobileTabBar" role="navigation" aria-label="Primary">
      <ul className="mobileTabList">
        {/* Gliding active-tab highlight. A decorative li (not a nav item) so it
            can sit inside the ul without breaking the list semantics; screen
            readers skip it via aria-hidden. Position comes from --active-index
            (translateX by 100% of its own 1/5-width column), so it only ever
            needs a transform to glide — no layout thrash. */}
        <li
          className="mobileTabHighlight"
          aria-hidden="true"
          style={
            {
              "--active-index": activeIndex,
              opacity: activeIndex === -1 ? 0 : 1,
            } as CSSProperties
          }
        />
        {tabs.map((tab) => {
          const active = isActive(pathname, tab);
          const { Icon } = tab;
          return (
            <li key={tab.label} className="mobileTabItem">
              <Link
                href={tab.href}
                className={
                  "mobileTab pressable" +
                  (tab.primary ? " mobileTabPrimary" : "") +
                  (active ? " isActive" : "")
                }
                aria-current={active ? "page" : undefined}
                onPointerDown={() => warmTab(tab.href)}
                onClick={() => markDropTap(tab.primary)}
                onMouseEnter={() => warmTab(tab.href)}
                onFocus={() => warmTab(tab.href)}
                onTouchStart={() => warmTab(tab.href)}
              >
                <span className="mobileTabIcon" aria-hidden="true">
                  <Icon
                    size={tab.primary ? 16 : 15}
                    strokeWidth={active ? 2.25 : 1.75}
                    fill="none"
                  />
                </span>
                <span className="mobileTabLabel">{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
