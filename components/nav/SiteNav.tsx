"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CirclePlus, type LucideIcon } from "lucide-react";
import {
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { useNowHref } from "@/lib/useNowHref";
import { useClientReady } from "@/lib/useClientReady";

import ThemeToggle from "@/components/ThemeToggle";
import IntentLink from "@/components/nav/IntentLink";
import { navIcon } from "@/components/nav/navIcons";
import MessagesLink from "@/components/nav/MessagesLink";
import { PalSiteNavButton } from "@/components/nav/PalNavButton";
import NotificationBell from "@/components/nav/NotificationBell";
import SiteNavMore from "@/components/nav/SiteNavMore";
import SignInButton from "@/components/auth/SignInButton";
import { returnToFromLocation } from "@/components/nav/createFabActions";
import PubmaxxWordmark from "@/components/brand/PubmaxxWordmark";
import { useCommandPalette } from "@/components/command/CommandPaletteProvider";
import {
  PRIMARY_NAV_ITEMS,
  momentHref,
  navPathMatches,
  primaryNavLabel,
} from "@/components/nav/navigationModel";
import { useSocialSurfaceName } from "@/lib/useSocialFriendsLaunch";
import { FOCUS_TRAP_EXEMPT_ATTRIBUTE } from "@/lib/useFocusTrap";
import {
  preferredCityMapHref,
  readPreferredCity,
  subscribePreferredCity,
} from "@/lib/cityPreference";

import { usePlanMapHref } from "@/components/nav/PlanMapNavigation";
import "./navigation.css";

// Shared app-wide top navigation. One bar, used on every APP page (map, feed,
// discover, crawls, profile, borough, admin) so navigation never duplicates or
// drifts page-to-page. The landing header renders the same action cluster
// (SiteNavActions below), so the front door and the app offer one set of
// controls.
//
// The mobile fix: at ≤640px the app already renders a fixed bottom tab bar
// (MobileTabBar: Map/Tonight/Plan/Social/You). Repeating the full link list up top
// there caused the old `.appNav` pill to overflow the viewport on /map.
// Mobile renders the wordmark, theme, account controls and signed-in activity.
// It hides the full link list (siteNav.css, @media ≤640px).
// On desktop the full links + active state show. Nothing may
// horizontally overflow at 390px.
//
// No effects: usePathname() marks the active link, which keeps this clear of
// react-hooks/set-state-in-effect. `active` can also be passed explicitly by the
// host page; the pathname is the fallback so a nav always lights the right tab.

type NavKey =
  | "home"
  | "now"
  | "today"
  | "map"
  | "places"
  | "pubs"
  | "drop"
  | "out"
  | "plan"
  | "spoons"
  | "tonight"
  | "historic"
  | "feed"
  | "discover"
  | "social"
  | "crawls"
  | "profile"
  | "borough";

type NavLink = {
  key: NavKey;
  href: Route;
  label: string;
  /** Path prefixes that should mark this link active (defaults to href). */
  match: string[];
  /** The door's icon, shared with the phone dock (navIcons.ts). */
  Icon: LucideIcon;
};

// Consumer nav only. Staff moderation lives at /admin (URL + token) and is
// intentionally absent from every public nav so demos never look like an
// admin console.
const LINKS: NavLink[] = PRIMARY_NAV_ITEMS.map((item) => ({
  ...item,
  key: (item.key === "you" ? "profile" : item.key) as NavKey,
  Icon: navIcon(item.key),
}));

function matchesPath(pathname: string, link: NavLink): boolean {
  return navPathMatches(pathname, link.match);
}

function primaryKeyForLegacyActive(active?: NavKey): NavKey | undefined {
  // Social is a primary tab, and its aliases light it too.
  if (active === "social" || active === "feed" || active === "discover") {
    return "social";
  }
  // The crawl routes are walks to plan, never Social (PLAN_NAV_MATCH).
  if (active === "crawls") return "plan";
  // Out folded into Tonight, so the retired Out page lights Tonight.
  if (active === "today" || active === "tonight" || active === "out") return "now";
  // The city picker is a setting reached from the map's chip, not a door.
  if (active === "places") return undefined;
  // Borough pages are data/discovery, not Social. There is no primary tab for
  // them, so they light nothing on the desktop nav rather than wrongly lighting
  // Social (the mobile tab bar already excludes /borough from its match set).
  if (active === "borough" || active === "home") return undefined;
  if (active === "pubs" || active === "historic") return undefined;
  return active;
}

/**
 * The right-hand action island, ONE component for the app bar and the landing
 * header. It offers the theme, desktop utilities and account controls.
 * The bell and messages appear only for signed-in visitors.
 */
export function SiteNavActions({ className = "siteNavActions" }: { className?: string }) {
  const ready = useClientReady();
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const liveMomentHref = () => momentHref(returnToFromLocation(window.location, pathname));
  // Imperative handle onto the global ⌘K palette (feature N1) — the button below
  // opens it for pointer users who won't reach for the shortcut.
  const { open: openCommandPalette } = useCommandPalette();

  return (
    <div className={className}>
      {/* The Pub Pal's own door (PalNavButton.tsx): the person's Pal and its
          name, first among the actions. Hidden <=640px, where it rises out of
          the phone dock instead. */}
      <PalSiteNavButton pathname={pathname} />
      <SiteNavMore />
      <ThemeToggle />
      {/* Moment compose (desktop). On phones the floating create action owns
          this; the top bar has no such affordance, so desktop users reach
          /moment here. Carries the same returnTo the mobile action uses
          (momentHref) so composing returns to the current page. Hidden ≤640px
          in siteNavMoment.css. */}
      <Link prefetch={false}
        href={momentHref(pathname)}
        className="siteNavMoment"
        aria-label="Share a Moment"
        title="Share a Moment"
        onPointerDown={(event) => { event.currentTarget.href = liveMomentHref(); }}
        onClick={(event) => { event.currentTarget.href = liveMomentHref(); }}
        onContextMenu={(event) => { event.currentTarget.href = liveMomentHref(); }}
        onNavigate={(event) => {
          event.preventDefault();
          router.push(liveMomentHref());
        }}
      >
        <CirclePlus size={20} aria-hidden="true" />
      </Link>
      {/* ⌘K command-palette affordance (feature N1). Unobtrusive hint button;
          hidden on phones (the bottom tab bar owns nav and there's no keyboard
          shortcut there). Label stays "⌘K" — Windows/Linux users still get the
          same palette via Ctrl+K. */}
      <button
        type="button"
        className="siteNavCmdk"
        disabled={!ready}
        onClick={openCommandPalette}
        aria-label="Open command palette"
        title="Search & jump to a page (⌘K / Ctrl+K)"
      >
        <kbd className="siteNavCmdkKbd" aria-hidden="true">
          ⌘K
        </kbd>
      </button>
      {/* Notification bell (story 34) and the 1:1 messaging inbox (E4). Both
          are signed-in only: a stranger has no activity and no inbox, so the
          components render nothing until a session exists. */}
      <NotificationBell />
      <MessagesLink />
      {/* Compact host: a single "Sign in" disclosure below the width where
          the two full provider buttons genuinely fit (auth.css ≥1680px), so
          they can never crowd the link row into clipped fragments. */}
      <SignInButton compact />
    </div>
  );
}

/** The width from which each door wears its icon and a hover pill glides. */
const SITE_NAV_GLIDE_QUERY = "(min-width: 1024px) and (hover: hover) and (pointer: fine)";

/**
 * Glide the hover pill to `link`. The first door the pointer meets gets the
 * pill in place, faded in rather than slid from nowhere; after that it slides
 * from door to door, the Animated Menu Bar's motion kept to the one thing a
 * reader's pointer is doing. Written straight to the element, so a hover
 * never re-renders the bar.
 */
function glideTo(row: HTMLElement, glide: HTMLElement, link: HTMLElement): void {
  const rowBox = row.getBoundingClientRect();
  const box = link.getBoundingClientRect();
  const arriving = glide.dataset.visible !== "true";
  if (arriving) glide.style.transition = "none";
  glide.style.transform = `translateX(${box.left - rowBox.left}px)`;
  glide.style.width = `${box.width}px`;
  if (arriving) {
    // Commit the jump before the fade-in, so only the fade is seen.
    void glide.offsetWidth;
    glide.style.transition = "";
  }
  glide.dataset.visible = "true";
}

export default function SiteNav({
  active,
}: {
  active?: NavKey;
}): React.JSX.Element {
  const floatingNavRef = useRef<HTMLElement>(null);
  const linksRef = useRef<HTMLUListElement>(null);
  const glideRef = useRef<HTMLLIElement>(null);
  const pathname = usePathname() ?? "";
  const primaryActive = primaryKeyForLegacyActive(active);
  const socialSurfaceLabel = useSocialSurfaceName();
  const preferredCity = useSyncExternalStore(
    subscribePreferredCity,
    readPreferredCity,
    () => null,
  );
  const mapHref = usePlanMapHref(preferredCity ? preferredCityMapHref() : "/map");
  const links = LINKS;
  const nowHref = useNowHref();

  // The map is full-bleed with an overflow-hidden shell, so the bar floats
  // (fixed) over it. Every other page keeps the bar in normal flow.
  // City maps live under /map/[city] — treat those as map too.
  const isMap =
    active === "map" || pathname === "/map" || pathname.startsWith("/map/");

  useLayoutEffect(() => {
    if (!isMap) return;
    const node = floatingNavRef.current;
    const shell = node?.closest<HTMLElement>(".appShell");
    if (!node || !shell) return;
    const property = "--site-nav-floating-height";
    let published = "";
    const sync = () => {
      published = `${Math.ceil(node.getBoundingClientRect().height)}px`;
      shell.style.setProperty(property, published);
    };
    sync();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    observer?.observe(node);
    return () => {
      observer?.disconnect();
      if (shell.style.getPropertyValue(property) === published) shell.style.removeProperty(property);
    };
  }, [isMap]);

  // Active state is the filled pill only (.siteNavLink.isActive) — same single
  // signal as the mobile tab bar. The gliding brass underline was removed so
  // desktop does not double-encode "here".
  const activeKey = links.find((link) =>
    primaryActive ? primaryActive === link.key : matchesPath(pathname, link),
  )?.key;

  return (
    <nav
      ref={floatingNavRef}
      {...(isMap ? { [FOCUS_TRAP_EXEMPT_ATTRIBUTE]: "" } : {})}
      className={isMap ? "siteNavBar siteNavBarFloating" : "siteNavBar"}
      role="navigation"
      aria-label="Site navigation"
    >
      {/* Wordmark: the compact-mobile anchor + the desktop home affordance. */}
      <Link prefetch={false} href="/" className="siteNavBrand" aria-label="Open PUBMAXX landing page">
        <PubmaxxWordmark />
      </Link>

      {/* Full link list — hidden on mobile (the bottom tab bar covers it).
          From 1024px each door wears its icon beside its word, a pill glides
          to the door under the pointer, and the door you are on gives its
          icon one small clink as the page arrives (siteNav.css). Below
          1024px the row is the measured word-only row it always was. */}
      <ul
        ref={linksRef}
        className="siteNavLinks"
        onPointerOver={(event: ReactPointerEvent<HTMLUListElement>) => {
          const row = linksRef.current;
          const glide = glideRef.current;
          if (!row || !glide || event.pointerType !== "mouse") return;
          if (typeof window.matchMedia !== "function" || !window.matchMedia(SITE_NAV_GLIDE_QUERY).matches) return;
          const link = (event.target as Element).closest<HTMLElement>(".siteNavLink");
          if (link && row.contains(link)) glideTo(row, glide, link);
        }}
        onPointerLeave={() => {
          if (glideRef.current) glideRef.current.dataset.visible = "false";
        }}
      >
        {links.map((link) => {
          const isActive = link.key === activeKey;
          const label = primaryNavLabel(link, socialSurfaceLabel);
          const { Icon } = link;
          return (
            <li key={link.key} className="siteNavItem">
              <IntentLink
                href={link.key === "map" ? mapHref : link.key === "now" ? nowHref : link.href}
                className={isActive ? "siteNavLink isActive" : "siteNavLink"}
                aria-current={isActive ? "page" : undefined}
                aria-label={label}
              >
                <Icon className="siteNavIcon" size={16} aria-hidden="true" />
                {label}
              </IntentLink>
            </li>
          );
        })}
        <li ref={glideRef} className="siteNavGlide" aria-hidden="true" data-visible="false" />
      </ul>

      <SiteNavActions />
    </nav>
  );
}
