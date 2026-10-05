"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A trap may only stand the rest of the page down when its own container is
 * on screen. The phone sheet portal stays MOUNTED at desktop widths and CSS
 * hides it (`display: none`, mobileMapShell.css). Its React state still runs,
 * so a sheet opened at the `full` detent used to inert the whole desktop app
 * behind a surface nobody could see: every pin, the toolbar search, and the
 * desktop Pint Drop picker's own rows went unclickable and unfocusable.
 * `displayChain` is the computed `display` of the container and each ancestor.
 */
export function shouldEngageFocusTrap(input: {
  active: boolean;
  displayChain: string[];
}): boolean {
  if (!input.active) return false;
  return !input.displayChain.includes("none");
}

export type FocusTrapOutsidePolicy = "strict-modal" | "map-surface";

const strictModalListeners = new Set<() => void>();
/** The containers each strict-modal trap holds, so a modal can ask about the others. */
const strictModalContainers = new Map<HTMLElement, number>();

export function subscribeStrictModalFocusTrap(listener: () => void): () => void {
  strictModalListeners.add(listener);
  return () => strictModalListeners.delete(listener);
}

export function readStrictModalFocusTrap(): boolean {
  return strictModalContainers.size > 0;
}

/**
 * Whether a strict modal OTHER than `own` holds the page. A modal that must
 * never stack on another strict one (two strict traps inert each other) asks
 * this, because its own trap is a strict modal too.
 */
export function readOtherStrictModalFocusTrap(own: Element | null): boolean {
  for (const container of strictModalContainers.keys()) {
    if (container !== own) return true;
  }
  return false;
}

export function serverStrictModalFocusTrap(): boolean {
  return false;
}

function publishStrictModalFocusTrap(): void {
  for (const listener of strictModalListeners) listener();
}

function claimStrictModalFocusTrap(container: HTMLElement): () => void {
  strictModalContainers.set(container, (strictModalContainers.get(container) ?? 0) + 1);
  publishStrictModalFocusTrap();
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const claims = (strictModalContainers.get(container) ?? 1) - 1;
    if (claims > 0) strictModalContainers.set(container, claims);
    else strictModalContainers.delete(container);
    publishStrictModalFocusTrap();
  };
}

/**
 * Body-level siblings that may stay interactive only beside a map surface.
 * The Android install card is a non-modal card drawn above the map sheets
 * (a2hsInstallPrompt.css). The trap scans the body once, so a card that mounted
 * before a sheet opened at half was made inert: the reader saw Install and Not
 * now and neither answered a tap.
 */
export function shouldInertOutsideSibling(
  node: HTMLElement,
  outsidePolicy: FocusTrapOutsidePolicy,
): boolean {
  if (outsidePolicy === "strict-modal") return true;
  return !(
    node.classList.contains("mobileTabBar") ||
    node.classList.contains("accountOnboardingBackdrop") ||
    node.classList.contains("a2hsSheet--android")
  );
}

type InertOwnership = {
  componentInert: boolean;
  owners: Set<symbol>;
  observer: MutationObserver;
};

const inertOwnership = new WeakMap<HTMLElement, InertOwnership>();

function captureComponentInert(
  node: HTMLElement,
  ownership: InertOwnership,
  deliveredRecords: MutationRecord[] = [],
): void {
  if (deliveredRecords.length || ownership.observer.takeRecords().length) {
    ownership.componentInert = node.inert;
  }
}

function enforceTrapInert(node: HTMLElement, ownership: InertOwnership): void {
  captureComponentInert(node, ownership);
  node.inert = true;
  // Our own write is not a new component claim.
  ownership.observer.takeRecords();
}

type FocusRestoration = {
  origin: HTMLElement | null;
  active: boolean;
};

const focusRestorations: FocusRestoration[] = [];

function claimInert(node: HTMLElement, owner: symbol): void {
  let ownership = inertOwnership.get(node);
  if (ownership) {
    captureComponentInert(node, ownership);
    ownership.owners.add(owner);
  } else {
    const observer = new MutationObserver((records) => {
      const current = inertOwnership.get(node);
      if (!current) return;
      captureComponentInert(node, current, records);
      if (current.owners.size > 0 && !node.inert) enforceTrapInert(node, current);
    });
    observer.observe(node, { attributes: true, attributeFilter: ["inert"] });
    ownership = {
      componentInert: node.inert,
      owners: new Set([owner]),
      observer,
    };
    inertOwnership.set(node, ownership);
  }
  enforceTrapInert(node, ownership);
}

function releaseInert(node: HTMLElement, owner: symbol): void {
  const ownership = inertOwnership.get(node);
  if (!ownership || !ownership.owners.delete(owner)) return;
  captureComponentInert(node, ownership);
  if (ownership.owners.size > 0) {
    enforceTrapInert(node, ownership);
    return;
  }
  ownership.observer.disconnect();
  node.inert = ownership.componentInert;
  inertOwnership.delete(node);
}

function focusOriginAvailable(origin: HTMLElement | null): origin is HTMLElement {
  if (!origin?.isConnected) return false;
  let cursor: HTMLElement | null = origin;
  while (cursor) {
    if (cursor.inert) return false;
    cursor = cursor.parentElement;
  }
  return true;
}

function restoreFocus(origin: HTMLElement | null): boolean {
  if (!focusOriginAvailable(origin)) return false;
  origin.focus({ preventScroll: true });
  return typeof document === "undefined" || document.activeElement === origin;
}

function releaseFocusRestoration(restoration: FocusRestoration): void {
  const index = focusRestorations.indexOf(restoration);
  if (index < 0 || !restoration.active) return;
  restoration.active = false;
  if (focusRestorations.slice(index + 1).some((entry) => entry.active)) return;

  let activeBarrier = -1;
  for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
    if (focusRestorations[candidate]?.active) {
      activeBarrier = candidate;
      break;
    }
  }
  for (let candidate = index; candidate > activeBarrier; candidate -= 1) {
    if (restoreFocus(focusRestorations[candidate]?.origin ?? null)) break;
  }
  focusRestorations.splice(activeBarrier + 1);
}

export class FocusTrapOwner {
  private readonly owner = Symbol("focus-trap-owner");
  private nodes = new Set<HTMLElement>();
  private focusRestoration: FocusRestoration | null = null;

  captureFocus(origin: HTMLElement | null): void {
    if (this.focusRestoration) return;
    this.focusRestoration = { origin, active: true };
    focusRestorations.push(this.focusRestoration);
  }

  reconcile(nextNodes: Iterable<HTMLElement>): void {
    const next = new Set(nextNodes);
    for (const node of this.nodes) {
      if (!next.has(node)) releaseInert(node, this.owner);
    }
    for (const node of next) {
      if (!this.nodes.has(node)) claimInert(node, this.owner);
    }
    this.nodes = next;
  }

  release(): void {
    this.reconcile([]);
    if (!this.focusRestoration) return;
    releaseFocusRestoration(this.focusRestoration);
    this.focusRestoration = null;
  }
}

/**
 * A map control that stays live beside a map-surface trap. The desktop venue
 * drawer traps focus, but the mapped-route chip belongs to the map, and a
 * reader must still reach "Check last train at final stop" while a pub is open
 * (drawer-trap-route-chip). A strict modal exempts nothing.
 */
export const FOCUS_TRAP_EXEMPT_ATTRIBUTE = "data-focus-trap-exempt";

export function trapExemptSurfaces(
  container: HTMLElement,
  outsidePolicy: FocusTrapOutsidePolicy,
): HTMLElement[] {
  if (outsidePolicy === "strict-modal") return [];
  return Array.from(
    container.ownerDocument.querySelectorAll<HTMLElement>(`[${FOCUS_TRAP_EXEMPT_ATTRIBUTE}]`),
  ).filter((node) => !container.contains(node));
}

/**
 * The nodes to inert. An outside sibling that holds no exempt surface is inert
 * whole, as before. A sibling that holds one is not: the walk goes down its
 * path and inerts every child beside it, so the exempt surface and its
 * ancestors stay interactive and nothing else on that path does. Inert is
 * inherited, so an exempt node inside an inert ancestor could never be live.
 */
export function inertTargets(
  siblings: Iterable<HTMLElement>,
  exempt: readonly HTMLElement[],
): Set<HTMLElement> {
  const targets = new Set<HTMLElement>();
  const visit = (node: HTMLElement) => {
    if (exempt.includes(node)) return;
    if (!exempt.some((surface) => node.contains(surface))) {
      targets.add(node);
      return;
    }
    for (const child of Array.from(node.children)) {
      if (child instanceof HTMLElement) visit(child);
    }
  };
  for (const sibling of siblings) visit(sibling);
  return targets;
}

/**
 * Where Tab goes at a region's edge. The trapped container is one region and
 * the exempt surfaces are a second, so Tab from the drawer's last control
 * reaches the chip and Tab from the chip's last control returns to the drawer.
 * Null means the move stays inside one region and the browser makes it.
 */
export function nextTrapFocus(input: {
  container: readonly HTMLElement[];
  exempt: readonly HTMLElement[];
  active: Element | null;
  shift: boolean;
}): HTMLElement | null {
  if (!input.container.length) return null;
  const regions = input.exempt.length
    ? [input.container, input.exempt]
    : [input.container];
  const index = regions.findIndex((region) =>
    region.some((node) => node === input.active),
  );
  const region = regions[index];
  if (!region) return null;
  const edge = input.shift ? region[0] : region.at(-1);
  if (input.active !== edge) return null;
  const next = regions[(index + (input.shift ? regions.length - 1 : 1)) % regions.length];
  return (input.shift ? next?.at(-1) : next?.[0]) ?? null;
}

function visibleFocusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (node) => node.offsetParent !== null,
  );
}

function outsideSiblings(
  container: HTMLElement,
  outsidePolicy: FocusTrapOutsidePolicy,
): Set<HTMLElement> {
  const siblings = new Set<HTMLElement>();
  let cursor: HTMLElement | null = container;
  while (cursor && cursor !== document.body) {
    const parent: HTMLElement | null = cursor.parentElement;
    if (!parent) break;
    for (const sibling of Array.from(parent.children)) {
      if (sibling === cursor || !(sibling instanceof HTMLElement)) continue;
      if (shouldInertOutsideSibling(sibling, outsidePolicy)) siblings.add(sibling);
    }
    cursor = parent;
  }
  return siblings;
}

function displayChain(container: HTMLElement): string[] {
  const chain: string[] = [];
  let cursor: HTMLElement | null = container;
  while (cursor) {
    chain.push(window.getComputedStyle(cursor).display);
    cursor = cursor.parentElement;
  }
  return chain;
}

// Shared modal focus trap, extracted from the mobile bottom sheet
// (MobileSharedSheet) so the desktop venue drawer can reuse the SAME behaviour
// for its full open lifetime. While `active`:
//   1. Tab / Shift+Tab cycle within `containerRef`'s visible focusables.
//   2. Outside siblings are marked `inert` according to `outsidePolicy`, walking
//      the ancestor chain to <body>. This works
//      whether the trapped node is a body-level portal (mobile sheet) or nested
//      inside the app shell (desktop drawer). Overlapping traps share ownership:
//      a claimed node stays inert until its final owner releases it, then restores
//      the latest component-written value, including changes made during the trap.
//   3. A container CSS has hidden never traps at all (shouldEngageFocusTrap).
// A map-surface trap allows designated exempt controls. While a strict modal is
// active, the map trap releases its inert claims and suspends Tab handling and
// focus reclaim.
// Focus entry and restoration are coordinated here; Esc stays with each caller.
export function useFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  outsidePolicy: FocusTrapOutsidePolicy = "strict-modal",
  focusOriginRef?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    const container = containerRef.current;
    if (!container) return;
    if (!shouldEngageFocusTrap({ active, displayChain: displayChain(container) })) return;

    const trapOwner = new FocusTrapOwner();
    trapOwner.captureFocus(
      focusOriginRef
        ? focusOriginRef.current
        : document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null,
    );
    // Main's one-time scan does not contain later body siblings such as Command Palette.
    const siblings = outsideSiblings(container, outsidePolicy);
    let exempt = trapExemptSurfaces(container, outsidePolicy);
    const suspended = () => outsidePolicy === "map-surface" && readStrictModalFocusTrap();
    const reconcileTrap = () => {
      trapOwner.reconcile(suspended() ? [] : inertTargets(siblings, exempt));
    };
    reconcileTrap();
    const unsubscribeStrictModal = outsidePolicy === "map-surface"
      ? subscribeStrictModalFocusTrap(reconcileTrap)
      : null;
    const releaseStrictModal =
      outsidePolicy === "strict-modal" ? claimStrictModalFocusTrap(container) : null;

    // An exempt surface can mount or leave while the trap holds: adding a
    // second stop from the drawer maps the route and mounts the chip. A node
    // can also mount beside the chip in a sibling the walk went down. Both are
    // re-derived from the SAME scanned siblings, once per frame at most.
    let exemptFocus: Element | null = null;
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      exemptFocus =
        target instanceof Element && exempt.some((surface) => surface.contains(target))
          ? target
          : null;
    };
    const reclaimLostExemptFocus = () => {
      if (suspended()) return;
      const lost = exemptFocus;
      if (!lost || exempt.some((surface) => surface.contains(lost))) return;
      exemptFocus = null;
      const active = document.activeElement;
      if (
        active &&
        active !== document.body &&
        (container.contains(active) || exempt.some((surface) => surface.contains(active)))
      ) {
        return;
      }
      (visibleFocusables(container)[0] ?? container).focus({ preventScroll: true });
    };

    let frame: number | null = null;
    const observer =
      outsidePolicy === "map-surface" && typeof MutationObserver !== "undefined"
        ? new MutationObserver(() => {
            if (frame !== null) return;
            frame = window.requestAnimationFrame(() => {
              frame = null;
              exempt = trapExemptSurfaces(container, outsidePolicy);
              reconcileTrap();
              reclaimLostExemptFocus();
            });
          })
        : null;
    for (const sibling of siblings) {
      observer?.observe(sibling, { childList: true, subtree: true });
    }

    const onTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.defaultPrevented || suspended()) return;
      const focusable = visibleFocusables(container);
      if (!focusable.length) return;
      if (document.activeElement === container) {
        event.preventDefault();
        (event.shiftKey ? focusable.at(-1) : focusable[0])?.focus();
        return;
      }
      const next = nextTrapFocus({
        container: focusable,
        exempt: exempt.flatMap(visibleFocusables),
        active: document.activeElement,
        shift: event.shiftKey,
      });
      if (!next) return;
      event.preventDefault();
      next.focus();
    };
    // On the document, because Tab from an exempt surface starts outside the
    // container. `nextTrapFocus` ignores focus that is in neither region.
    document.addEventListener("keydown", onTab);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onTab);
      document.removeEventListener("focusin", onFocusIn);
      observer?.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
      unsubscribeStrictModal?.();
      releaseStrictModal?.();
      // Components clear their modal-owned inert state before focus returns.
      queueMicrotask(() => trapOwner.release());
    };
  }, [active, containerRef, focusOriginRef, outsidePolicy]);
}
