"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CirclePlus } from "lucide-react";
import {
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";

import ThemeToggle from "@/components/ThemeToggle";
import MessagesLink from "@/components/nav/MessagesLink";
import NotificationBell from "@/components/nav/NotificationBell";
import SignInButton from "@/components/auth/SignInButton";
import PubmaxxWordmark from "@/components/brand/PubmaxxWordmark";
import { useCommandPalette } from "@/components/command/CommandPaletteProvider";
import {
  preferredCityMapHref,
  subscribePreferredCity,
} from "@/lib/cityPreference";
import { PRIMARY_NAV_ITEMS, momentHref, navPathMatches } from "@/components/nav/navigationModel";

import "./siteNav.css";
import "./siteNavMoment.css";

// Shared app-wide top navigation. One bar, used on every APP page (map, feed,
// discover, crawls, profile, borough, admin) so navigation never duplicates or
// drifts page-to-page.
//
// The mobile fix: at ≤640px the app already renders a fixed bottom tab bar
// (MobileTabBar — Map/Tonight/Moment/Stories/You). Repeating the full link list up
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
  | "today"
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
};

// Consumer nav only. Staff moderation lives at /admin (URL + token) and is
// intentionally absent from every public nav so demos never look like an
// admin console.
// The /today morning brief (Lane A). Added here rather than in the shared
// PRIMARY_NAV_ITEMS model so the primary-nav contract test stays intact; it
// leads the desktop link list as the "before you go" home surface.
const TODAY_LINK: NavLink = { key: "today", href: "/today", label: "Today", match: ["/today"] };

const LINKS: NavLink[] = [
  TODAY_LINK,
  ...PRIMARY_NAV_ITEMS.map((item) => ({
    ...item,
    key: (item.key === "stories" ? "discover" : item.key === "you" ? "profile" : item.key) as NavKey,
  })),
];

function matchesPath(pathname: string, link: NavLink): boolean {
  return navPathMatches(pathname, link.match);
}

function primaryKeyForLegacyActive(active?: NavKey): NavKey | undefined {
  if (active === "feed" || active === "crawls") return "discover";
  // Borough pages are data/discovery, not Stories. There is no primary tab for
  // them, so they light nothing on the desktop nav rather than wrongly lighting
  // Stories (the mobile tab bar already excludes /borough from its match set).
  if (active === "borough" || active === "home") return undefined;
  if (active === "pubs" || active === "historic") return undefined;
  return active;
}

// Gliding active-link indicator (siteNav.css .siteNavIndicator). Links are
// variable-width labels, not equal columns like the mobile tab bar, so the
// indicator's geometry has to be measured off the real DOM node rather than
// derived from an index. Kept to a thin underline (not a repaint of the
// existing `.siteNavLink.isActive` pill) so it stays geometrically stable.
type IndicatorRect = { x: number; width: number; visible: boolean };
const HIDDEN_INDICATOR: IndicatorRect = { x: 0, width: 0, visible: false };

export default function SiteNav({
  active,
  mobileMapUtility,
}: {
  active?: NavKey;
  mobileMapUtility?: ReactNode;
}): React.JSX.Element {
  const pathname = usePathname() ?? "";
  const primaryActive = primaryKeyForLegacyActive(active);
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
    return link;
  });

  // The map is full-bleed with an overflow-hidden shell, so the bar floats
  // (fixed) over it. Every other page keeps the bar in normal flow.
  // City maps live under /map/[city] — treat those as map too.
  const isMap =
    active === "map" || pathname === "/map" || pathname.startsWith("/map/");

  const activeKey = links.find((link) =>
    primaryActive ? primaryActive === link.key : matchesPath(pathname, link),
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
      <Link href="/" className="siteNavBrand" aria-label="Open PUBMAXX landing page">
        <PubmaxxWordmark />
      </Link>

      {isMap && mobileMapUtility ? (
        <div className="siteNavMapUtility">{mobileMapUtility}</div>
      ) : null}

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
                title={link.label}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="siteNavActions">
        {/* Moment compose (desktop). On phones the bottom tab bar's raised
            centre FAB owns this; the top bar has no such affordance, so desktop
            users reach /moment here. Carries the same returnTo the mobile FAB
            uses (momentHref) so composing returns to the current page. Hidden
            ≤640px in siteNavMoment.css — the FAB covers mobile. */}
        <Link
          href={momentHref(pathname)}
          className="siteNavMoment"
          aria-label="Share a Moment"
          title="Share a Moment"
        >
          <CirclePlus size={18} aria-hidden="true" />
        </Link>
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
