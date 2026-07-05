"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Map, Newspaper, CirclePlus, Route, User } from "lucide-react";
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

const TABS: Tab[] = [
  { href: "/map", label: "Map", Icon: Map, match: ["/map"] },
  { href: "/feed", label: "Feed", Icon: Newspaper, match: ["/feed"] },
  { href: "/map?log=1", label: "Log", Icon: CirclePlus, primary: true },
  { href: "/crawls", label: "Crawls", Icon: Route, match: ["/crawls"] },
  { href: "/u/you", label: "Profile", Icon: User, match: ["/u"] },
];

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

  return (
    <nav className="mobileTabBar" role="navigation" aria-label="Primary">
      <ul className="mobileTabList">
        {TABS.map((tab) => {
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
