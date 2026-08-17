"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Map, UserRound, Images, CalendarClock, DoorOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useSyncExternalStore, type CSSProperties } from "react";
import {
  preferredCityMapHref,
  subscribePreferredCity,
} from "@/lib/cityPreference";
import { useViewerHandle } from "@/components/auth/useViewerHandle";
import { whenBackgroundWarmupAllowed } from "@/lib/backgroundWarmup";
import { warmNavRoute, warmPrimaryTabRoutes } from "@/lib/mapWarmup";
import {
  PRIMARY_NAV_ITEMS,
  navPathMatches,
  nowTabHref,
  serverNowTabHref,
  subscribeNowTabHref,
  type PrimaryNavKey,
} from "@/components/nav/navigationModel";
import {
  readSocialFriendsLaunchFromDocument,
  socialPrimaryNavLabel,
  subscribeSocialFriendsLaunchFromDocument,
} from "@/lib/socialLaunch";
import { requestMobileSheetDismiss } from "@/lib/mobileShell";
import {
  readSoftKeyboardOpen,
  serverSoftKeyboardOpen,
  subscribeSoftKeyboard,
} from "@/lib/softKeyboard";
import {
  readStrictModalFocusTrap,
  serverStrictModalFocusTrap,
  subscribeStrictModalFocusTrap,
} from "@/lib/useFocusTrap";
import "./mobileNav.css";

// Mobile-first bottom tab bar. Mounted on every non-root route and visible only
// ≤640px (see mobileNav.css); exact root landing intentionally omits it so
// Find my pint owns entry. On desktop it is display:none, leaving existing
// desktop navs untouched.
//
// Five destinations. Compose lives on the floating + action, never in this row.
//
// Path active-state is pure (usePathname). Mount-time prefetch of destination
// tabs is the only effect — it must not set state (react-hooks/set-state-in-effect).

type Tab = {
  key: PrimaryNavKey;
  href: string;
  label: string;
  Icon: typeof Map;
  /** Path prefixes that should mark this tab active (defaults to href). */
  match?: string[];
};

const warmedTabs = new Set<string>();

// Map follows the preferred city (null → /map). Now follows London wall clock.
// Exported for the five-tab contract test (order + destinations are load-bearing).
export function buildTabs(
  mapHref: string,
  youHref = "/u/you",
  nowHref: "/today" | "/tonight" = "/today",
): Tab[] {
  const icons = { now: CalendarClock, map: Map, out: DoorOpen, social: Images, you: UserRound };
  return PRIMARY_NAV_ITEMS.map((item) => ({
    ...item,
    href:
      item.key === "now"
        ? nowHref
        : item.key === "map"
          ? mapHref
          : item.key === "you"
            ? youHref
            : item.href,
    Icon: icons[item.key],
  }));
}

function isActive(pathname: string, tab: Tab): boolean {
  return navPathMatches(pathname, tab.match ?? [tab.href]);
}

export function shouldShowMobileTabBar(pathname: string): boolean {
  return pathname !== "/";
}

export function MobileTabBarClearanceFallback() {
  const pathname = usePathname() ?? "";
  if (!shouldShowMobileTabBar(pathname)) return null;
  return <div className="mobileTabBarClearance" aria-hidden="true" />;
}

export default function MobileTabBar() {
  const pathname = usePathname() ?? "";
  if (!shouldShowMobileTabBar(pathname)) return null;
  return <MobileTabBarContent pathname={pathname} />;
}

function MobileTabBarContent({ pathname }: { pathname: string }) {
  const router = useRouter();
  // Preference may be null → /map. useSyncExternalStore: SSR/hydration stay on
  // /map, then re-read after mount (and when CitySwitcher writes).
  const mapHref = useSyncExternalStore(
    subscribePreferredCity,
    preferredCityMapHref,
    () => "/map",
  );
  // Now flips at 17:00 London. The SERVER snapshot is a constant, not a clock
  // read: a prerendered document held by the CDN would otherwise hydrate against
  // an href the browser had already moved past. See navigationModel.
  const nowHref = useSyncExternalStore(
    subscribeNowTabHref,
    nowTabHref,
    serverNowTabHref,
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
  const strictModalOpen = useSyncExternalStore(
    subscribeStrictModalFocusTrap,
    readStrictModalFocusTrap,
    serverStrictModalFocusTrap,
  );
  const socialFriendsLaunch = useSyncExternalStore(
    subscribeSocialFriendsLaunchFromDocument,
    readSocialFriendsLaunchFromDocument,
    () => false,
  );
  const tabs = useMemo(() => {
    const built = buildTabs(mapHref, youHref, nowHref);
    return built.map((tab) =>
      tab.key === "social"
        ? { ...tab, label: socialPrimaryNavLabel(socialFriendsLaunch) }
        : tab,
    );
  }, [mapHref, youHref, nowHref, socialFriendsLaunch]);
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

  // Background warmup of every OTHER durable tab destination (Now / Map /
  // Out / Social / You). Extends the landing map-warmup pattern so a cold
  // thumb-tap does not wait on first-fetch of the target route bundle. No
  // setState.
  //
  // Held until the foreground surface has painted, and never issued for the
  // route already on screen. Non-root mounts spend the current page's main
  // thread and bandwidth on the next tap;
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

  const onPrimaryTabNavigate = useCallback(() => {
    requestMobileSheetDismiss();
  }, []);

  return (
    <nav
      className={"mobileTabBar" + (keyboardOpen ? " isKeyboardHidden" : "")}
      role="navigation"
      aria-label="Primary"
      // Hidden from the reader means hidden from a screen reader too: a bar
      // that has slid off the bottom of the screen must not still be a tab stop
      // above the keyboard.
      aria-hidden={keyboardOpen || undefined}
      inert={keyboardOpen || strictModalOpen || undefined}
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
                // automatic prefetch fires for all five tab destinations while the
                // current page is still painting. This component already owns a
                // better-timed warm for exactly those routes: gated behind the
                // foreground paint below, and on pointer/hover/focus intent
                // above. Leaving the automatic one on top only duplicates it at
                // the worst moment.
                prefetch={false}
                className={"mobileTab pressable" + (active ? " isActive" : "")}
                aria-current={active ? "page" : undefined}
                onPointerDown={() => warmTab(tab.href)}
                onClick={onPrimaryTabNavigate}
                onMouseEnter={() => warmTab(tab.href)}
                onFocus={() => warmTab(tab.href)}
                onTouchStart={() => warmTab(tab.href)}
              >
                <span className="mobileTabIcon" aria-hidden="true">
                  <Icon
                    size={15}
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
