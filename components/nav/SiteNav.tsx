"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home } from "lucide-react";
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";

import ThemeToggle from "@/components/ThemeToggle";
import MessagesLink from "@/components/nav/MessagesLink";
import NotificationBell from "@/components/nav/NotificationBell";
import SignInButton from "@/components/auth/SignInButton";
import { useCommandPalette } from "@/components/command/CommandPaletteProvider";
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
  | "drop"
  | "tonight"
  | "historic"
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
  { key: "tonight", href: "/tonight", label: "Tonight", match: ["/tonight"], accent: "other" },
  { key: "historic", href: "/historic", label: "Historic", match: ["/historic"], accent: "wine" },
  // Desktop carries the same five core concepts as the mobile tab bar (C1);
  // Pint Drop opens the composer on the preferred city's map. match is a
  // never-matching sentinel: /map belongs to the Map link, so this one never
  // shows as active.
  { key: "drop", href: "/map?log=1", label: "Pint Drop", match: ["/__never__"], accent: "shot" },
  { key: "feed", href: "/feed", label: "Feed", match: ["/feed"], accent: "cocktail" },
  { key: "discover", href: "/discover", label: "Pint stories", match: ["/discover"], accent: "gin" },
  { key: "borough", href: "/borough", label: "Boroughs", match: ["/borough"], accent: "wine" },
  { key: "crawls", href: "/crawls", label: "Crawls", match: ["/crawls"], accent: "rum" },
  { key: "profile", href: "/u/you", label: "You", match: ["/u"], accent: "vodka" },
];

function matchesPath(pathname: string, link: NavLink): boolean {
  return link.match.some((prefix) =>
    // "/" only matches the home route exactly (every path starts with "/").
    prefix === "/" ? pathname === "/" : pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

// Gliding active-link indicator (siteNav.css .siteNavIndicator). Links are
// variable-width labels, not equal columns like the mobile tab bar, so the
// indicator's geometry has to be measured off the real DOM node rather than
// derived from an index. Kept to a thin underline (not a repaint of the
// existing `.siteNavLink.isActive` pill) so it never has to duplicate the
// category-tint (data-cat) logic already owned by that pill.
type IndicatorRect = { x: number; width: number; visible: boolean };
const HIDDEN_INDICATOR: IndicatorRect = { x: 0, width: 0, visible: false };

export default function SiteNav({ active }: { active?: NavKey }): React.JSX.Element {
  const pathname = usePathname() ?? "";
  // Imperative handle onto the global ⌘K palette (feature N1) — the button below
  // opens it for pointer users who won't reach for the shortcut.
  const { open: openCommandPalette } = useCommandPalette();
  // Preference may be null → /map. useSyncExternalStore keeps SSR/hydration on
  // /map, then re-reads after mount (and on CitySwitcher writes).
  const mapHref = useSyncExternalStore(
    subscribePreferredCity,
    preferredCityMapHref,
    () => "/map",
  );
  const links = LINKS.map((link) => {
    if (link.key === "map") return { ...link, href: mapHref };
    if (link.key === "drop") {
      // Same city-aware base as the Map link, with the composer flag.
      return { ...link, href: `${mapHref}${mapHref.includes("?") ? "&" : "?"}log=1` };
    }
    return link;
  });

  // The map is full-bleed with an overflow-hidden shell, so the bar floats
  // (fixed) over it. Every other page keeps the bar in normal flow.
  // City maps live under /map/[city] — treat those as map too.
  const isMap =
    active === "map" || pathname === "/map" || pathname.startsWith("/map/");

  const activeKey = links.find((link) =>
    active ? active === link.key : matchesPath(pathname, link),
  )?.key;

  const linkRefs = useRef<Partial<Record<NavKey, HTMLAnchorElement>>>({});
  const [indicator, setIndicator] = useState<IndicatorRect>(HIDDEN_INDICATOR);

  // DOM measurement can only happen after paint, so — unlike the rest of this
  // component — this genuinely needs an effect (not derived render state).
  // useLayoutEffect keeps the measure-then-move in the same paint the browser
  // is already doing, so there's no visible jump to the old position first.
  useLayoutEffect(() => {
    const el = activeKey ? linkRefs.current[activeKey] : undefined;
    if (!el) {
      setIndicator(HIDDEN_INDICATOR);
      return;
    }
    const measure = () => setIndicator({ x: el.offsetLeft, width: el.offsetWidth, visible: true });
    measure();
    // Link widths shift at the 1180px/900px density breakpoints (siteNav.css);
    // re-measure so the indicator doesn't strand itself on resize.
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [activeKey]);

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
        {/* Gliding underline, decorative only (aria-hidden) — see siteNav.css
            .siteNavIndicator. Sits behind the links (painted first; flex items
            paint above per the flexbox stacking rules) so it never covers the
            label text it's tracking. */}
        <li
          className="siteNavIndicator"
          aria-hidden="true"
          style={
            {
              "--nav-indicator-x": `${indicator.x}px`,
              "--nav-indicator-scale": indicator.width,
              opacity: indicator.visible ? 1 : 0,
            } as CSSProperties
          }
        />
        {links.map((link) => {
          const isActive = link.key === activeKey;
          return (
            <li key={link.key} className="siteNavItem">
              <Link
                ref={(el) => {
                  if (el) linkRefs.current[link.key] = el;
                  else delete linkRefs.current[link.key];
                }}
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
        {/* ⌘K command-palette affordance (feature N1). Unobtrusive hint button;
            hidden on phones (the bottom tab bar owns nav and there's no keyboard
            shortcut there). Label stays "⌘K" — Windows/Linux users still get the
            same palette via Ctrl+K. */}
        <button
          type="button"
          className="siteNavCmdk"
          onClick={openCommandPalette}
          aria-label="Open command palette"
          title="Search & jump to a page (⌘K / Ctrl+K)"
        >
          <kbd className="siteNavCmdkKbd" aria-hidden="true">
            ⌘K
          </kbd>
        </button>
        {/* Notification bell (story 34) — unread-count badge + link to /activity.
            Shows on mobile too (the compact bar keeps the bell + toggle + sign-in). */}
        <NotificationBell />
        {/* E4: 1:1 messaging inbox link — unread-count badge + link to /messages.
            Same ambient island shape as the bell; shows on mobile too. */}
        <MessagesLink />
        <ThemeToggle />
        {/* Compact host: a single "Sign in" disclosure below the width where
            the two full provider buttons genuinely fit (auth.css ≥1680px), so
            they can never crowd the link row into clipped fragments. */}
        <SignInButton compact />
      </div>
    </nav>
  );
}
