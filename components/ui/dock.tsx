"use client";

/**
 * Dock: a row of controls that grow under a mouse pointer.
 *
 * Adapted from the Dock in Motion Primitives (https://motion-primitives.com,
 * github.com/ibelick/motion-primitives), as bookmarked on 21st.dev. The MIT
 * notice is at the foot of this comment (and in THIRD_PARTY_NOTICES.md). The
 * API is the same four parts, Dock, DockItem, DockLabel and DockIcon, but the
 * house rules changed what is inside them:
 *
 * - An item is a presentational box around a REAL control. The original item
 *   was a div with role="button" that Enter and Space could not press; here the
 *   caller puts a <button> or <a> inside DockItem and that control carries the
 *   accessible name.
 * - Every colour, corner and size reads a launch token. Tailwind's palette
 *   classes and `dark:` are not used: the tokens already follow
 *   html[data-theme], and the palette pair read about 2.5:1 in dark.
 * - The resting item is 44px, the tap floor.
 * - It magnifies only for a fine pointer that can hover, and never under
 *   reduced motion. Otherwise every item rests at its own size and a label
 *   fades in by opacity alone, so the effect jumps to its target.
 * - The pointer is read in viewport coordinates (clientX), the same space as
 *   getBoundingClientRect, so a scrolled page magnifies the item under the
 *   pointer and not one beside it.
 * - The frame reserves the magnified height up front. The original sprang its
 *   own height on hover, which pushes everything under it inside a panel.
 * - Keyboard focus magnifies its item the way the pointer does, and Left,
 *   Right, Home and End move focus along the row.
 *
 * Motion Primitives, copyright (c) ibelick and the Motion Primitives
 * contributors. MIT licence:
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import {
  AnimatePresence,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useSpring,
  useTransform,
  type MotionValue,
  type SpringOptions,
} from "framer-motion";
import {
  createContext,
  useContext,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

/** The resting size of an item: the 44px tap floor. */
const DOCK_ITEM_SIZE = 44;
const DEFAULT_MAGNIFICATION = 72;
const DEFAULT_DISTANCE = 140;
const DEFAULT_PANEL_HEIGHT = 64;
/** Room above the tallest item for its label to rise into. */
const LABEL_ROOM = 40;
const DEFAULT_SPRING: SpringOptions = { mass: 0.1, stiffness: 150, damping: 12 };
/** The same curve as --ease-out-strong in app/globals.css. */
const EASE_OUT_STRONG = [0.23, 1, 0.32, 1] as const;
const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const DOCK_CONTROL_SELECTOR =
  "[data-dock-item] :is(a[href], button:not([disabled]))";

type DockProps = {
  children: ReactNode;
  className?: string;
  /** How far from an item, in px, the pointer still grows it. */
  distance?: number;
  /** The height of the visible panel the items sit in. */
  panelHeight?: number;
  /** The width an item grows to when the pointer is on it. */
  magnification?: number;
  spring?: SpringOptions;
  /** False keeps every item at its resting size. */
  magnify?: boolean;
  role?: "toolbar" | "group";
  "aria-label"?: string;
};

type DockItemProps = {
  className?: string;
  children: ReactNode;
};

type DockLabelProps = {
  className?: string;
  children: ReactNode;
  /** True shows the label whatever the pointer does (a selected item). */
  visible?: boolean;
};

type DockIconProps = {
  className?: string;
  children: ReactNode;
};

type DockContextValue = {
  mouseX: MotionValue<number>;
  spring: SpringOptions;
  magnification: number;
  distance: number;
  live: boolean;
};

type DockItemContextValue = {
  width: MotionValue<number>;
  isHovered: MotionValue<number>;
};

const DockContext = createContext<DockContextValue | undefined>(undefined);
const DockItemContext = createContext<DockItemContextValue | undefined>(undefined);

function useDock(): DockContextValue {
  const context = useContext(DockContext);
  if (!context) throw new Error("DockItem must be used inside a Dock");
  return context;
}

function useDockItem(): DockItemContextValue {
  const context = useContext(DockItemContext);
  if (!context) throw new Error("DockLabel and DockIcon must be used inside a DockItem");
  return context;
}

function mediaQuery(query: string): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(query)
    : null;
}

function subscribeDockMedia(onChange: () => void): () => void {
  const queries = [mediaQuery(FINE_POINTER_QUERY), mediaQuery(REDUCED_MOTION_QUERY)];
  for (const query of queries) query?.addEventListener("change", onChange);
  return () => {
    for (const query of queries) query?.removeEventListener("change", onChange);
  };
}

/**
 * The reader asked for less motion: the system setting, or Legacy Mode
 * (html[data-legacy="1"]), which turns motion down for its CSS too. Read live
 * rather than through framer-motion's useReducedMotion, which settles its
 * answer once per page.
 */
function readReducedMotion(): boolean {
  if (typeof document !== "undefined" && document.documentElement.dataset.legacy === "1") {
    return true;
  }
  return mediaQuery(REDUCED_MOTION_QUERY)?.matches === true;
}

function readMagnifies(): boolean {
  return mediaQuery(FINE_POINTER_QUERY)?.matches === true && !readReducedMotion();
}

/** True when this Dock should grow its items: a hovering pointer, motion allowed. */
function useDockMagnifies(magnify: boolean): boolean {
  const magnifies = useSyncExternalStore(subscribeDockMedia, readMagnifies, () => false);
  return magnify && magnifies;
}

function useDockReducedMotion(): boolean {
  return useSyncExternalStore(subscribeDockMedia, readReducedMotion, () => false);
}

/** Left, Right, Home and End move focus along the row's controls. */
function moveDockFocus(event: KeyboardEvent<HTMLDivElement>): void {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const controls = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(DOCK_CONTROL_SELECTOR),
  ];
  const current = controls.indexOf(
    event.currentTarget.ownerDocument.activeElement as HTMLElement,
  );
  if (current < 0) return;
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? controls.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + controls.length) %
          controls.length;
  event.preventDefault();
  controls[next]?.focus();
}

function Dock({
  children,
  className,
  spring = DEFAULT_SPRING,
  magnification = DEFAULT_MAGNIFICATION,
  distance = DEFAULT_DISTANCE,
  panelHeight = DEFAULT_PANEL_HEIGHT,
  magnify = true,
  role = "toolbar",
  "aria-label": ariaLabel = "Application dock",
}: DockProps) {
  const mouseX = useMotionValue(Number.POSITIVE_INFINITY);
  const live = useDockMagnifies(magnify);
  // The item rests centred in the panel and grows up out of it, so the frame
  // holds the tallest item plus its label from the first paint.
  const restingPad = Math.max(0, (panelHeight - DOCK_ITEM_SIZE) / 2);
  const reach = live ? Math.max(magnification, DOCK_ITEM_SIZE) : DOCK_ITEM_SIZE;
  const frameHeight = Math.max(panelHeight, reach + restingPad + LABEL_ROOM);

  return (
    <div
      className="flex max-w-full items-end overflow-x-auto"
      style={{ height: frameHeight, scrollbarWidth: "none" }}
      data-dock-magnifies={live ? "" : undefined}
    >
      <div
        onMouseMove={live ? (event) => mouseX.set(event.clientX) : undefined}
        onMouseLeave={() => mouseX.set(Number.POSITIVE_INFINITY)}
        onKeyDown={moveDockFocus}
        className={cn(
          "mx-auto flex w-fit items-end gap-3 rounded-[var(--radius-lg)] border border-[var(--hairline)] bg-[var(--panel-raised)] px-3",
          className,
        )}
        style={{ height: panelHeight, paddingBottom: restingPad }}
        role={role}
        aria-label={ariaLabel}
      >
        <DockContext.Provider value={{ mouseX, spring, distance, magnification, live }}>
          {children}
        </DockContext.Provider>
      </div>
    </div>
  );
}

function DockItem({ children, className }: DockItemProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { distance, magnification, mouseX, spring, live } = useDock();
  const isHovered = useMotionValue(0);

  const mouseDistance = useTransform(mouseX, (pointerX) => {
    const rect = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
    return pointerX - rect.x - rect.width / 2;
  });
  const widthTransform = useTransform(
    mouseDistance,
    [-distance, 0, distance],
    [DOCK_ITEM_SIZE, magnification, DOCK_ITEM_SIZE],
  );
  const springWidth = useSpring(widthTransform, spring);
  const restingWidth = useMotionValue(DOCK_ITEM_SIZE);
  const width = live ? springWidth : restingWidth;

  return (
    <motion.div
      ref={ref}
      data-dock-item=""
      style={{ width }}
      onHoverStart={() => isHovered.set(1)}
      onHoverEnd={() => isHovered.set(0)}
      onFocus={() => {
        isHovered.set(1);
        // Focus grows its item as the pointer would, from the item's centre.
        if (!live || !ref.current) return;
        const rect = ref.current.getBoundingClientRect();
        mouseX.set(rect.x + rect.width / 2);
      }}
      onBlur={() => {
        isHovered.set(0);
        if (live) mouseX.set(Number.POSITIVE_INFINITY);
      }}
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
    >
      <DockItemContext.Provider value={{ width, isHovered }}>
        {children}
      </DockItemContext.Provider>
    </motion.div>
  );
}

function DockLabel({ children, className, visible = false }: DockLabelProps) {
  const { isHovered } = useDockItem();
  const reducedMotion = useDockReducedMotion();
  const [hovered, setHovered] = useState(false);
  useMotionValueEvent(isHovered, "change", (latest) => setHovered(latest === 1));
  // Reduced motion keeps the fade and drops the rise.
  const rest = reducedMotion ? -10 : 0;

  return (
    <AnimatePresence>
      {visible || hovered ? (
        <motion.span
          initial={{ opacity: 0, y: rest }}
          animate={{ opacity: 1, y: -10 }}
          exit={{ opacity: 0, y: rest, transition: { duration: 0.1 } }}
          transition={{ duration: 0.16, ease: EASE_OUT_STRONG }}
          className={cn(
            "pointer-events-none absolute -top-6 left-1/2 w-fit whitespace-pre rounded-[var(--radius-sm)] border border-[var(--hairline)] bg-[var(--color-surface-raised)] px-2 py-0.5 text-[length:var(--text-xs)] font-bold text-[var(--color-text)]",
            className,
          )}
          // The control inside the item carries the accessible name, so the
          // label is what a sighted reader sees and nothing more.
          aria-hidden="true"
          style={{ x: "-50%" }}
        >
          {children}
        </motion.span>
      ) : null}
    </AnimatePresence>
  );
}

function DockIcon({ children, className }: DockIconProps) {
  const { width } = useDockItem();
  const iconSize = useTransform(width, (value) => value / 2);

  return (
    <motion.span
      style={{ width: iconSize, height: iconSize }}
      className={cn("flex items-center justify-center", className)}
      aria-hidden="true"
    >
      {children}
    </motion.span>
  );
}

export { Dock, DockIcon, DockItem, DockLabel };
