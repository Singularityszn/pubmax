"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Map, CirclePlus, User, Compass, Beer } from "lucide-react";
import { useCallback, useSyncExternalStore, type CSSProperties } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  preferredCityMapHref,
  subscribePreferredCity,
} from "@/lib/cityPreference";
import { warmMapRoute } from "@/lib/mapWarmup";
import { markPubmaxTiming } from "@/lib/performanceMarks";
import "./mobileNav.css";

// Mobile-first bottom tab bar. Visible only ≤640px (see mobileNav.css); on
// desktop it is display:none so the existing desktop navs are untouched.
//
// Log is the emphasized centre action — larger, brass — linking to the map with
// the composer opened (?log=1). The other four are plain destinations.
//
// No effects: usePathname() is enough to mark the active tab, which keeps this
// clear of react-hooks/set-state-in-effect.

type Tab = {
  href: string;
  label: string;
  Icon: typeof Map;
  /** Path prefixes that should mark this tab active (defaults to href). */
  match?: string[];
  /** The emphasized centre action. */
  primary?: boolean;
};

const warmedTabs = new Set<string>();

// The Profile tab's destination is the only auth-aware bit: signed-in users go
// to /u/<their handle>, everyone else keeps the demo /u/you. `match: ["/u"]`
// marks the tab active for any profile route in either case.
// Map + Pubs + Discover; Drop stays the centre action; You for profile.
// Map / Drop hrefs follow the preferred city (null → /map).
function buildTabs(profileHref: string, mapHref: string, dropHref: string): Tab[] {
  return [
    { href: mapHref, label: "Map", Icon: Map, match: ["/map"] },
    { href: "/pubs", label: "Pubs", Icon: Beer, match: ["/pubs"] },
    { href: dropHref, label: "Drop", Icon: CirclePlus, primary: true },
    { href: "/discover", label: "Discover", Icon: Compass, match: ["/discover", "/feed", "/borough"] },
    { href: profileHref, label: "You", Icon: User, match: ["/u"] },
  ];
}

function isActive(pathname: string, tab: Tab): boolean {
  // The Log tab points at /map?log=1 — a mode of the map, not its own page — so
  // it is never marked as the current page (the Map tab owns /map).
  if (tab.primary) return false;
  const prefixes = tab.match ?? [tab.href];
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export default function MobileTabBar() {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  // Signed-in → their derived handle; signed-out (or still loading) → demo /you.
  const { handle } = useAuth();
  // Preference may be null → /map. useSyncExternalStore: SSR/hydration stay on
  // /map, then re-read after mount (and when CitySwitcher writes).
  const mapHref = useSyncExternalStore(
    subscribePreferredCity,
    preferredCityMapHref,
    () => "/map",
  );
  const dropHref = useSyncExternalStore(
    subscribePreferredCity,
    () => preferredCityMapHref(new URLSearchParams({ log: "1" })),
    () => "/map?log=1",
  );
  const tabs = buildTabs(handle ? `/u/${handle}` : "/u/you", mapHref, dropHref);
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

  if (pathname === "/") return null;

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
