"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home } from "lucide-react";
import { useSyncExternalStore } from "react";

import ThemeToggle from "@/components/ThemeToggle";
import MessagesLink from "@/components/nav/MessagesLink";
import NotificationBell from "@/components/nav/NotificationBell";
import SignInButton from "@/components/auth/SignInButton";
import {
  preferredCityMapHref,
  subscribePreferredCity,
} from "@/lib/cityPreference";

import "./siteNav.css";

// Shared app-wide top navigation. One bar, used on every APP page (map, feed,
// discover, crawls, profile, borough, admin) so navigation never duplicates or
// drifts page-to-page.
//
// The mobile fix: at ≤640px the app already renders a fixed bottom tab bar
// (MobileTabBar — Map/Pubs/Drop/Discover/You). Repeating the full link list up
// top there caused the old `.appNav` pill to overflow the viewport (Admin +
// theme toggle clipped off-screen) on /map. So on mobile this renders a COMPACT
// bar — just the wordmark + theme toggle + sign-in — and hides the full link
// list (see siteNav.css @media ≤640px). On desktop the full links + active
// state show. Nothing may horizontally overflow at 390px.
//
// No effects: usePathname() marks the active link, which keeps this clear of
// react-hooks/set-state-in-effect. `active` can also be passed explicitly by the
// host page; the pathname is the fallback so a nav always lights the right tab.

type NavKey =
  | "home"
  | "map"
  | "pubs"
  | "feed"
  | "discover"
  | "crawls"
  | "profile"
  | "borough";

type NavLink = {
  key: NavKey;
  href: string;
  label: string;
  /** Path prefixes that should mark this link active (defaults to href). */
  match: string[];
  /** Optional category tint for the active/hover state. */
  accent?: "beer" | "wine" | "whisky" | "gin" | "vodka" | "rum" | "cocktail" | "shot" | "other";
};

// Consumer nav only. Staff moderation lives at /admin (URL + token) and is
// intentionally absent from every public nav so demos never look like an
// admin console.
const LINKS: NavLink[] = [
  { key: "map", href: "/map", label: "Map", match: ["/map"], accent: "beer" },
  { key: "pubs", href: "/pubs", label: "Pubs", match: ["/pubs"], accent: "whisky" },
  { key: "feed", href: "/feed", label: "Feed", match: ["/feed"], accent: "cocktail" },
  { key: "discover", href: "/discover", label: "Drinks", match: ["/discover"], accent: "gin" },
  { key: "borough", href: "/borough", label: "London", match: ["/borough"], accent: "wine" },
  { key: "crawls", href: "/crawls", label: "Crawls", match: ["/crawls"], accent: "rum" },
  { key: "profile", href: "/u/you", label: "You", match: ["/u"], accent: "vodka" },
];

function matchesPath(pathname: string, link: NavLink): boolean {
  return link.match.some((prefix) =>
    // "/" only matches the home route exactly (every path starts with "/").
    prefix === "/" ? pathname === "/" : pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export default function SiteNav({ active }: { active?: NavKey }): React.JSX.Element {
  const pathname = usePathname() ?? "";
  // Preference may be null → /map. useSyncExternalStore keeps SSR/hydration on
  // /map, then re-reads after mount (and on CitySwitcher writes).
  const mapHref = useSyncExternalStore(
    subscribePreferredCity,
    preferredCityMapHref,
    () => "/map",
  );
  const links = LINKS.map((link) =>
    link.key === "map" ? { ...link, href: mapHref } : link,
  );

  // The map is full-bleed with an overflow-hidden shell, so the bar floats
  // (fixed) over it. Every other page keeps the bar in normal flow.
  // City maps live under /map/[city] — treat those as map too.
  const isMap =
    active === "map" || pathname === "/map" || pathname.startsWith("/map/");

  return (
    <nav
      className={isMap ? "siteNavBar siteNavBarFloating" : "siteNavBar"}
      role="navigation"
      aria-label="Site navigation"
    >
      {/* Wordmark: the compact-mobile anchor + the desktop home affordance. */}
      <Link href="/" className="siteNavBrand" aria-label="Open PUBMAXXING landing page">
        <span className="siteNavBrandFull">PUBMAXXING</span>
        <span className="siteNavBrandMobile" aria-hidden="true">
          <Home size={13} strokeWidth={2.25} />
          <span>Home</span>
        </span>
      </Link>

      {/* Full link list — hidden on mobile (the bottom tab bar covers it). */}
      <ul className="siteNavLinks">
        {links.map((link) => {
          const isActive = active ? active === link.key : matchesPath(pathname, link);
          return (
            <li key={link.key} className="siteNavItem">
              <Link
                href={link.href}
                className={isActive ? "siteNavLink isActive" : "siteNavLink"}
                aria-current={isActive ? "page" : undefined}
                aria-label={link.label}
                data-cat={link.accent}
                title={link.label}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="siteNavActions">
        {/* Notification bell (story 34) — unread-count badge + link to /activity.
            Shows on mobile too (the compact bar keeps the bell + toggle + sign-in). */}
        <NotificationBell />
        {/* E4: 1:1 messaging inbox link — unread-count badge + link to /messages.
            Same ambient island shape as the bell; shows on mobile too. */}
        <MessagesLink />
        <ThemeToggle />
        <SignInButton />
      </div>
    </nav>
  );
}
