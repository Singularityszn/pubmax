import type { Route } from "next";
import { momentHref } from "@/components/nav/navigationModel";
import { preferredCityMapHref } from "@/lib/cityPreference";
import { withPriceContributionIntent } from "@/lib/priceContributionIntent";

/**
 * What the floating create action offers, and where each row goes.
 *
 * Destination decisions belong here, including the remembered-city fallback
 * when price logging starts outside the map. The component renders this table.
 */
type CreateFabActionKey = "moment" | "price" | "plan";

export type CreateFabAction = {
  action: CreateFabActionKey;
  label: string;
  /** `returnTo` is the live route WITH its query, so composing from
   *  /map?sel=venue-123 comes back to that pub rather than to a bare map. */
  hrefFor: (returnTo: string) => Route;
};

/**
 * Where "back" is, read off the live address bar.
 *
 * Read at the action boundary because the Map's native-history writes can
 * precede the router's next render. The router value is the fallback before
 * a browser location exists.
 */
export function returnToFromLocation(
  location: { pathname?: string; search?: string } | null | undefined,
  fallback: string,
): string {
  const pathname = location?.pathname;
  if (!pathname || !pathname.startsWith("/")) return fallback;
  return `${pathname}${location?.search ?? ""}`;
}

function categoryPriceHref(returnTo: string): Route {
  const url = new URL(
    /^\/map(?:\/[^/?#]+)?(?:[?#]|$)/.test(returnTo)
      ? returnTo
      : preferredCityMapHref(),
    "https://pubmaxxing.com",
  );
  url.searchParams.delete("log");
  url.searchParams.delete("price");
  // The base is always a /map path, and the intent param keeps it one.
  return withPriceContributionIntent(url.href) as Route;
}

export const CREATE_FAB_ACTIONS: readonly CreateFabAction[] = [
  { action: "moment", label: "Post a moment", hrefFor: (returnTo) => momentHref(returnTo) },
  { action: "price", label: "Log a price", hrefFor: categoryPriceHref },
  { action: "plan", label: "Start a plan", hrefFor: () => "/plan" },
] as const;

/**
 * Routes with no use for a compose control.
 *
 * The tab-bar chrome rides EVERY route (`shouldShowMobileTabBar`), and that
 * law is untouched: this is the narrower question of whether the floating
 * create action belongs beside the content. On the Pub Pal intro it does not -
 * the page is one coral call to action, and a second coral circle beside it
 * offers three unrelated compositions.
 *
 * The sign-in, sign-up and add-account surfaces share `/login`, where the
 * floating control overlaps the form's terms link.
 *
 * Pages that cannot be named by path carry the `pageHidesCreateFab` marker
 * class instead (createFab.css): the 404 renders under whatever address was
 * mistyped, and `/pal/chat`, threads and plan pages hide it from their own
 * markup.
 */
const CREATE_FAB_HIDDEN_PATHS: readonly string[] = ["/pal", "/login", "/moment", "/plan"];

export function createFabVisible(pathname: string): boolean {
  return !CREATE_FAB_HIDDEN_PATHS.includes(pathname);
}

/**
 * The sheet may never be painted while the control it hangs off is hidden. The
 * keyboard answer is therefore part of the render, not only of an effect: an
 * effect that closed it would still paint one frame of a menu over the caret.
 */
export function createFabMenuVisible(open: boolean, keyboardOpen: boolean): boolean {
  return open && !keyboardOpen;
}
