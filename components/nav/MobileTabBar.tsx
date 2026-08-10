"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Map, CirclePlus, UserRound, Images, CalendarClock, Sunrise } from "lucide-react";
import { useCallback, useEffect, useMemo, useSyncExternalStore, type CSSProperties } from "react";
import {
  preferredCityMapHref,
  subscribePreferredCity,
} from "@/lib/cityPreference";
import { useViewerHandle } from "@/components/auth/useViewerHandle";
import { whenBackgroundWarmupAllowed } from "@/lib/backgroundWarmup";
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
import { requestMobileSheetDismiss } from "@/lib/mobileShell";
import {
  readSoftKeyboardOpen,
  serverSoftKeyboardOpen,
  subscribeSoftKeyboard,
} from "@/lib/softKeyboard";
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
  // You tab: when identity is known, point straight at /u/<handle> instead of
  // the /u/you sentinel (which client-redirects after mount and doubles the
  // navigation cost — the cold-tap 846ms prod median). Unknown identity takes
  // the sentinel: one extra hop beats naming the wrong person.
  const youHandle = useViewerHandle();
  const youHref = youHandle ? `/u/${encodeURIComponent(youHandle)}` : "/u/you";
  // The bar is fixed to the LAYOUT viewport, which no phone browser shrinks for
  // the keyboard, so it floats over whatever is being typed into. lib/softKeyboard.ts
  // owns the rule (a focused text field AND a shrunken visual viewport); here it
  // only ever adds a class, and the CSS slides the bar out by transform alone so
  // the reserved body clearance never moves under the caret.
  const keyboardOpen = useSyncExternalStore(
    subscribeSoftKeyboard,
    readSoftKeyboardOpen,
    serverSoftKeyboardOpen,
  );
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

  // Background warmup of every OTHER durable tab destination (Today / Map /
  // Tonight / Social / You). Extends the landing map-warmup pattern so a cold
  // thumb-tap does not wait on first-fetch of the target route bundle. No
  // setState.
  //
  // Held until the foreground surface has painted, and never issued for the
  // route already on screen. The bar mounts on every page, so a mount-time
  // warm spends the current page's main thread and bandwidth on the next tap;
  // on the map that cost lands squarely inside MapLibre's init. See
  // lib/backgroundWarmup.ts for why plain idle is not enough.
  useEffect(() => {
    return whenBackgroundWarmupAllowed(() => {
      warmPrimaryTabRoutes(
        router,
        tabs.map((tab) => tab.href),
        warmedTabs,
        pathname,
      );
    });
  }, [router, tabs, pathname]);

  const markDropTap = useCallback((primary?: boolean) => {
    if (primary) markPubmaxTiming("pubmax:drop-tap");
  }, []);

  const onPrimaryTabNavigate = useCallback(
    (primary?: boolean) => {
      requestMobileSheetDismiss();
      markDropTap(primary);
    },
    [markDropTap],
  );

  return (
    <nav
      className={"mobileTabBar" + (keyboardOpen ? " isKeyboardHidden" : "")}
      role="navigation"
      aria-label="Primary"
      // Hidden from the reader means hidden from a screen reader too: a bar
      // that has slid off the bottom of the screen must not still be a tab stop
      // above the keyboard.
      aria-hidden={keyboardOpen || undefined}
      inert={keyboardOpen || undefined}
    >
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
                // The bar sits in the viewport on every page, so Next's
                // automatic prefetch fires for all six destinations while the
                // current page is still painting. This component already owns a
                // better-timed warm for exactly those routes: gated behind the
                // foreground paint below, and on pointer/hover/focus intent
                // above. Leaving the automatic one on top only duplicates it at
                // the worst moment.
                prefetch={false}
                className={
                  "mobileTab pressable" +
                  (tab.primary ? " mobileTabPrimary" : "") +
                  (active ? " isActive" : "")
                }
                aria-current={active ? "page" : undefined}
                onPointerDown={() => warmTab(tab.href)}
                onClick={() => onPrimaryTabNavigate(tab.primary)}
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
