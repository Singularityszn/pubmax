import { momentHref } from "@/components/nav/navigationModel";

/**
 * What the floating create action offers, and where each row goes.
 *
 * Pure, and the ONE place a destination is decided: the component renders this
 * table and nothing else, so a row cannot be given one href here and another one
 * at the call site.
 */
export type CreateFabActionKey = "moment" | "price" | "plan";

export type CreateFabAction = {
  action: CreateFabActionKey;
  label: string;
  /** `returnTo` is the live route WITH its query, so composing from
   *  /map?sel=venue-123 comes back to that pub rather than to a bare map. */
  hrefFor: (returnTo: string) => string;
};

/**
 * Where "back" is, read off the live address bar.
 *
 * `useSearchParams` is not the honest source here: the Map writes its whole
 * selection into the URL with `history.pushState` / `replaceState`, which Next's
 * router never hears, so a reader who tapped a pin and then composed would be
 * sent back to a bare `/map`. PubMap reads `window.location` for exactly this
 * reason. The router's value stays as the fallback because it is the only
 * reading available before a window exists.
 */
export function returnToFromLocation(
  location: { pathname?: string; search?: string } | null | undefined,
  fallback: string,
): string {
  const pathname = location?.pathname;
  if (!pathname || !pathname.startsWith("/")) return fallback;
  return `${pathname}${location?.search ?? ""}`;
}

export const CREATE_FAB_ACTIONS: readonly CreateFabAction[] = [
  { action: "moment", label: "Post a moment", hrefFor: (returnTo) => momentHref(returnTo) },
  { action: "price", label: "Log a price", hrefFor: () => "/map?log=1" },
  { action: "plan", label: "Start a plan", hrefFor: () => "/plan" },
] as const;

/**
 * The sheet may never be painted while the control it hangs off is hidden. The
 * keyboard answer is therefore part of the render, not only of an effect: an
 * effect that closed it would still paint one frame of a menu over the caret.
 */
export function createFabMenuVisible(open: boolean, keyboardOpen: boolean): boolean {
  return open && !keyboardOpen;
}
