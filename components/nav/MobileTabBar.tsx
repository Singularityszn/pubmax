"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Map, CirclePlus, UserRound, Images, CalendarClock, Sunrise } from "lucide-react";
import { useCallback, useEffect, useMemo, useSyncExternalStore, type CSSProperties } from "react";
import {
  preferredCityMapHref,
  subscribePreferredCity,
} from "@/lib/cityPreference";
import { readDeviceHandle } from "@/lib/identityClaimClient";
import { warmNavRoute, warmPrimaryTabRoutes } from "@/lib/mapWarmup";
import { markPubmaxTiming } from "@/lib/performanceMarks";
import {
  MOMENT_NAV_ACTION,
  PRIMARY_NAV_ITEMS,
  TOUR_TARGET_TAB_KEY,
  momentHref,
  navPathMatches,
  type PrimaryNavKey,
  type TourSpotlightTarget,
} from "@/components/nav/navigationModel";
import "./mobileNav.css";

// Mobile-first bottom tab bar. Visible only ≤640px (see mobileNav.css); on
// desktop it is display:none so the existing desktop navs are untouched.
//
// Moment is the emphasized centre action and opens the private-first camera
// composer. Pint Drop remains an explicit action inside Moment and the map.
//
// Path active-state is pure (usePathname). Mount-time prefetch of destination
// tabs is the only effect — it must not set state (react-hooks/set-state-in-effect).

type Tab = {
  key: PrimaryNavKey | "today" | typeof MOMENT_NAV_ACTION.key;
  href: string;
  label: string;
  Icon: typeof Map;
  /** Path prefixes that should mark this tab active (defaults to href). */
  match?: string[];
  /** The emphasized centre action. */
  primary?: boolean;
};

const warmedTabs = new Set<string>();

// The /today morning brief (Lane A). Added here rather than in the shared
// PRIMARY_NAV_ITEMS model so the primary-nav contract test stays intact; it
// leads the tab row as the "before you go" home surface.
const TODAY_TAB: Omit<Tab, "Icon" | "primary"> = {
  key: "today",
  href: "/today",
  label: "Today",
  match: ["/today"],
};

// Map follows the preferred city (null → /map); every other route is canonical.
// Exported for the six-tab contract test (order + destinations are load-bearing).
export function buildTabs(mapHref: string, pathname: string, youHref = "/u/you"): Tab[] {
  const icons = { today: Sunrise, map: Map, tonight: CalendarClock, moment: CirclePlus, social: Images, you: UserRound };
  const primary = PRIMARY_NAV_ITEMS.map((item) => ({
    ...item,
    href: item.key === "map" ? mapHref : item.key === "you" ? youHref : item.href,
    Icon: icons[item.key],
  }));
  // Today, Map | Moment (centre) | Tonight, Social, You.
  const destinations = [{ ...TODAY_TAB, Icon: icons.today }, ...primary];
  return [
    ...destinations.slice(0, 2),
    { ...MOMENT_NAV_ACTION, href: momentHref(pathname), match: [], Icon: icons.moment, primary: true },
    ...destinations.slice(2),
  ];
}

// Resolve a first-run tour spotlight target ("map" | "drop" | "social") to
// its live column in the tab row, so the tour ring is positioned from the REAL
// tab geometry and moves with it if the row grows or reorders. Args are
// irrelevant to the order/count, so the canonical /map pair is fine. Exported
// for the tour and its geometry regression test.
export function tourSpotlightColumn(target: TourSpotlightTarget): { index: number; total: number } {
  const tabs = buildTabs("/map", "/map");
  return {
    index: tabs.findIndex((tab) => tab.key === TOUR_TARGET_TAB_KEY[target]),
    total: tabs.length,
  };
}

function isActive(pathname: string, tab: Tab): boolean {
  // The primary Moment action is intentionally not painted as a persistent
  // active tab; its raised shape communicates creation rather than location.
  if (tab.primary) return false;
  return navPathMatches(pathname, tab.match ?? [tab.href]);
}

function subscribeDeviceHandle(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
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
  // You tab: when the device already has a claimed handle, point straight at
  // /u/<handle> instead of the /u/you sentinel (which client-redirects after
  // mount and doubles the navigation cost — the cold-tap 846ms prod median).
  const deviceHandle = useSyncExternalStore(
    subscribeDeviceHandle,
    readDeviceHandle,
    () => "",
  );
  const youHref = deviceHandle ? `/u/${encodeURIComponent(deviceHandle)}` : "/u/you";
  const returnTo = `${pathname}${searchParams.size ? `?${searchParams.toString()}` : ""}`;
  const tabs = useMemo(
    () => buildTabs(mapHref, returnTo, youHref),
    [mapHref, returnTo, youHref],
  );
  // Drives the gliding highlight pill (mobileNav.css). -1 (no match — e.g. a
  // route none of the tabs own) hides it via CSS rather than pinning it to a
  // wrong tab.
  const activeIndex = tabs.findIndex((tab) => isActive(pathname, tab));
  const warmTab = useCallback(
    (href: string) => {
      warmNavRoute(router, href, warmedTabs);
    },
    [router],
  );

  // Mount-time warmup of every durable tab destination (Today / Map / Tonight /
  // Social / You). Extends the landing map-warmup pattern so a cold thumb-tap
  // does not wait on first-fetch of the target route bundle. No setState.
  useEffect(() => {
    warmPrimaryTabRoutes(
      router,
      tabs.map((tab) => tab.href),
      warmedTabs,
    );
  }, [router, tabs]);

  const markDropTap = useCallback((primary?: boolean) => {
    if (primary) markPubmaxTiming("pubmax:drop-tap");
  }, []);

  return (
    <nav className="mobileTabBar" role="navigation" aria-label="Primary">
      {/* --tab-count feeds the count-driven layout model in mobileNav.css:
          column width and highlight geometry all derive from it (and from
          --tab-inset), so the CSS never assumes a tab total. */}
      <ul
        className="mobileTabList"
        style={{ "--tab-count": tabs.length } as CSSProperties}
      >
        {/* Gliding active-tab highlight. A decorative li (not a nav item) so it
            can sit inside the ul without breaking the list semantics; screen
            readers skip it via aria-hidden. Position comes from --active-index
            (translateX by 100% of its own one-column width), so it only ever
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
                prefetch
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
