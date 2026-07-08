"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Map, Newspaper, CirclePlus, User, Wine } from "lucide-react";
import { useCallback } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { warmMapIntent } from "@/lib/mapWarmup";
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
function buildTabs(profileHref: string): Tab[] {
  return [
    { href: "/map", label: "Map", Icon: Map, match: ["/map"] },
    { href: "/feed", label: "Stories", Icon: Newspaper, match: ["/feed"] },
    { href: "/map?log=1", label: "Drop", Icon: CirclePlus, primary: true },
    { href: "/discover", label: "Drinks", Icon: Wine, match: ["/discover"] },
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
  const tabs = buildTabs(handle ? `/u/${handle}` : "/u/you");
  const warmTab = useCallback(
    (href: string) => {
      const prefetchHref = href.split("?")[0] || href;
      if (warmedTabs.has(prefetchHref)) return;
      warmedTabs.add(prefetchHref);
      router.prefetch(prefetchHref);
      if (prefetchHref === "/map") warmMapIntent();
    },
    [router],
  );

  if (pathname === "/") return null;

  return (
    <nav className="mobileTabBar" role="navigation" aria-label="Primary">
      <ul className="mobileTabList">
        {tabs.map((tab) => {
          const active = isActive(pathname, tab);
          const { Icon } = tab;
          return (
            <li key={tab.label} className="mobileTabItem">
              <Link
                href={tab.href}
                className={
                  "mobileTab" +
                  (tab.primary ? " mobileTabPrimary" : "") +
                  (active ? " isActive" : "")
                }
                aria-current={active ? "page" : undefined}
                onPointerDown={() => warmTab(tab.href)}
                onMouseEnter={() => warmTab(tab.href)}
                onFocus={() => warmTab(tab.href)}
                onTouchStart={() => warmTab(tab.href)}
              >
                <span className="mobileTabIcon" aria-hidden="true">
                  <Icon size={tab.primary ? 26 : 22} strokeWidth={1.75} />
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
