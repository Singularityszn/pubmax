"use client";

import type { Route as NextRoute } from "next";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Map, UserRound, Route, CalendarClock, Images } from "lucide-react";
import { useCallback, useMemo, useSyncExternalStore, type CSSProperties } from "react";
import { useViewerHandle } from "@/components/auth/useViewerHandle";
import { useViewerSession } from "@/components/auth/useViewerSession";
import { profilePath } from "@/lib/appLink";
import { warmNavRoute } from "@/lib/mapWarmup";
import {
  PRIMARY_NAV_ITEMS,
  navPathMatches,
  primaryNavLabel,
  type PrimaryNavKey,
} from "@/components/nav/navigationModel";
import { socialSurfaceName } from "@/lib/socialLaunch";
import { useSocialSurfaceName } from "@/lib/useSocialFriendsLaunch";
import { requestMobileSheetDismiss } from "@/lib/mobileShell";
import {
  preferredCityMapHref,
  readPreferredCity,
  subscribePreferredCity,
} from "@/lib/cityPreference";
import {
  readSoftKeyboardOpen,
  serverSoftKeyboardOpen,
  subscribeSoftKeyboard,
} from "@/lib/softKeyboard";
import {
  FOCUS_TRAP_EXEMPT_ATTRIBUTE,
  readStrictModalFocusTrap,
  serverStrictModalFocusTrap,
  subscribeStrictModalFocusTrap,
} from "@/lib/useFocusTrap";
import "./mobileNav.css";

// Mobile-first bottom tab bar. Mounted on every route and visible only ≤640px
// (see mobileNav.css). On desktop it is display:none, leaving existing desktop
// navs untouched.
//
// Five durable destinations in the order of the loop (navigationModel): Map,
// Tonight, Plan, Social, You. Out folded into Tonight and Places is a setting
// reached from the map's city chip, so neither is a tab any more. Compose lives
// on the floating + action, never in this row.
//
// Social is named for its launch state. While the friends launch is rolled
// back, its accessible name is "Social preview" and the dock shows the word
// "Social" with the preview dot, because "Social preview" in a fifth of a
// 320px bar is cut short.
//
// Path active-state is pure (usePathname). Route warming starts only from
// pointer, hover, touch, or focus intent.

type Tab = {
  key: PrimaryNavKey;
  href: NextRoute;
  label: string;
  Icon: typeof Map;
  /** The link's accessible name. The large text bucket hides the tab word
   *  (mobileNav.css), so the name must live on the link, not in that word. */
  ariaLabel: string;
  /** Path prefixes that should mark this tab active (defaults to href). */
  match?: string[];
  /** True while the tab's surface is a preview (Social before its launch). */
  preview: boolean;
};

const warmedTabs = new Set<string>();
const subscribeHydration = () => () => {};

// Map follows preferred city after mount, with /map as the server fallback.
// Exported for the tab contract test.
export function buildTabs(
  youHref: NextRoute = "/u/you" as NextRoute,
  mapHref: NextRoute = "/map",
  socialLabel: string = socialSurfaceName(true),
): Tab[] {
  const icons = {
    now: CalendarClock,
    map: Map,
    plan: Route,
    social: Images,
    you: UserRound,
  };
  return PRIMARY_NAV_ITEMS
    .map((item) => ({
      ...item,
      ariaLabel: primaryNavLabel(item, socialLabel),
      preview: primaryNavLabel(item, socialLabel) !== item.label,
      href:
        item.key === "map"
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
  void pathname;
  return true;
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
  const preferredCity = useSyncExternalStore(
    subscribePreferredCity,
    readPreferredCity,
    () => null,
  );
  const mapHref = preferredCity ? preferredCityMapHref() : "/map";
  // A confirmed account with a canonical handle goes straight to its profile.
  // A device handle alone cannot prove that the viewer is signed in. Keep
  // signed-out and unresolved viewers on /u/you, where the account page owns
  // the session decision, while preserving the direct signed-in navigation.
  const youHandle = useViewerHandle();
  const { signedIn } = useViewerSession();
  // Auth can settle before this Suspense boundary hydrates. Match the server
  // href on hydration, then publish the live destination on the same anchor.
  // Otherwise React can retain /u/you despite Link receiving the new props.
  const youHref = useSyncExternalStore(
    subscribeHydration,
    () => signedIn && youHandle ? profilePath(youHandle) : ("/u/you" as NextRoute),
    () => "/u/you" as NextRoute,
  );
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
  const socialLabel = useSocialSurfaceName();
  const tabs = useMemo(
    () => buildTabs(youHref, mapHref, socialLabel),
    [youHref, mapHref, socialLabel],
  );
  // Drives the gliding highlight pill (mobileNav.css). -1 (no match — e.g. a
  // route none of the tabs own) hides it via CSS rather than pinning it to a
  // wrong tab.
  const activeIndex = tabs.findIndex((tab) => isActive(pathname, tab));
  const warmTab = useCallback(
    (href: NextRoute) => {
      warmNavRoute(router, href, warmedTabs);
    },
    [router],
  );

  const onPrimaryTabNavigate = useCallback(() => {
    requestMobileSheetDismiss();
  }, []);

  return (
    <nav
      className={"mobileTabBar" + (keyboardOpen ? " isKeyboardHidden" : "")}
      role="navigation"
      aria-label="Primary"
      {...{ [FOCUS_TRAP_EXEMPT_ATTRIBUTE]: "" }}
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
                // intent warm below replaces it. Leaving the automatic one on
                // top downloads unrelated route code before the current page is
                // useful.
                prefetch={false}
                className={"mobileTab pressable" + (active ? " isActive" : "")}
                aria-label={tab.ariaLabel}
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
                <span className="mobileTabLabel">
                  <span className="mobileTabLabelText">{tab.label}</span>
                  {tab.preview ? <span className="mobileTabPreviewDot" aria-hidden="true" /> : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
