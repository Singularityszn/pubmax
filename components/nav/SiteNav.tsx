"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import ThemeToggle from "@/components/ThemeToggle";
import LegacyToggle from "@/components/LegacyToggle";
import MessagesLink from "@/components/nav/MessagesLink";
import NotificationBell from "@/components/nav/NotificationBell";
import ViewModeSwitch from "@/components/nav/ViewModeSwitch";
import SignInButton from "@/components/auth/SignInButton";

import "./siteNav.css";

// Shared app-wide top navigation. One bar, used on every APP page (map, feed,
// discover, crawls, profile, borough, admin) so navigation never duplicates or
// drifts page-to-page.
//
// The mobile fix: at ≤640px the app already renders a fixed bottom tab bar
// (MobileTabBar — Map/Feed/Log/Crawls/Profile). Repeating the full link list up
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
  | "feed"
  | "discover"
  | "crawls"
  | "profile"
  | "borough"
  | "admin";

type NavLink = {
  key: NavKey;
  href: string;
  label: string;
  /** Path prefixes that should mark this link active (defaults to href). */
  match: string[];
};

// The public link set, in display order. Admin is intentionally NOT here — it is
// appended below only outside production so it never shows in the public nav.
const LINKS: NavLink[] = [
  { key: "home", href: "/", label: "Home", match: ["/"] },
  { key: "map", href: "/map", label: "Map", match: ["/map"] },
  { key: "feed", href: "/feed", label: "Feed", match: ["/feed"] },
  { key: "discover", href: "/discover", label: "Discover", match: ["/discover"] },
  { key: "borough", href: "/borough", label: "Boroughs", match: ["/borough"] },
  { key: "crawls", href: "/crawls", label: "Crawls", match: ["/crawls"] },
  { key: "profile", href: "/u/you", label: "Profile", match: ["/u"] },
];

// Admin is a dev/preview-only convenience link. In production it is hidden from
// the public nav entirely — /admin stays reachable by direct URL (its own token
// gate is unchanged). Read at module scope: NODE_ENV is a build-time constant.
const SHOW_ADMIN = process.env.NODE_ENV !== "production";
const ADMIN_LINK: NavLink = {
  key: "admin",
  href: "/admin",
  label: "Admin",
  match: ["/admin"],
};

function matchesPath(pathname: string, link: NavLink): boolean {
  return link.match.some((prefix) =>
    // "/" only matches the home route exactly (every path starts with "/").
    prefix === "/" ? pathname === "/" : pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export default function SiteNav({ active }: { active?: NavKey }): React.JSX.Element {
  const pathname = usePathname() ?? "";
  const links = SHOW_ADMIN ? [...LINKS, ADMIN_LINK] : LINKS;

  // The map is full-bleed with an overflow-hidden shell, so the bar floats
  // (fixed) over it. Every other page keeps the bar in normal flow.
  const isMap = active === "map" || pathname === "/map";

  return (
    <nav
      className={isMap ? "siteNavBar siteNavBarFloating" : "siteNavBar"}
      role="navigation"
      aria-label="Site navigation"
    >
      {/* Wordmark: the compact-mobile anchor + the desktop home affordance. */}
      <Link href="/" className="siteNavBrand">
        PUBMAXXING
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
        {/* Lock-In / Ledger mode switch (dual-modes surface). A view layer that
            composes Legacy Mode + the calm lane — see ViewModeSwitch / lib/viewMode. */}
        <ViewModeSwitch />
        <ThemeToggle />
        <LegacyToggle />
        <SignInButton />
      </div>
    </nav>
  );
}
