"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import {
  Suspense,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { shouldShowMobileTabBar } from "@/components/nav/MobileTabBar";
import {
  CREATE_FAB_ACTIONS,
  createFabMenuVisible,
} from "@/components/nav/createFabActions";
import { trackEvent } from "@/lib/analytics";
import {
  readSoftKeyboardOpen,
  serverSoftKeyboardOpen,
  subscribeSoftKeyboard,
} from "@/lib/softKeyboard";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";

import "./createFab.css";

// The compose affordance. It reads useSearchParams so a Moment carries the
// query of the route it was composed from, which puts it behind a Suspense
// boundary of its own: this is mounted in the root layout, and `/` and `/map`
// are prerendered documents that an unwrapped read would pull back to per-request.
export default function CreateFab() {
  return (
    <Suspense fallback={null}>
      <CreateFabGate />
    </Suspense>
  );
}

function CreateFabGate() {
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  if (!shouldShowMobileTabBar(pathname)) return null;
  return <CreateFabContent returnTo={`${pathname}${query ? `?${query}` : ""}`} />;
}

function CreateFabContent({ returnTo }: { returnTo: string }) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const keyboardOpen = useSyncExternalStore(
    subscribeSoftKeyboard,
    readSoftKeyboardOpen,
    serverSoftKeyboardOpen,
  );

  const close = useCallback(() => setOpen(false), []);
  useDismissOnEscape(open, close);

  // The sheet leaves with the control, and it does NOT come back when the
  // keyboard goes down. Adjusted during render rather than in an effect: an
  // effect would paint one frame of a menu over the caret first.
  const [keyboardWas, setKeyboardWas] = useState(keyboardOpen);
  if (keyboardOpen !== keyboardWas) {
    setKeyboardWas(keyboardOpen);
    if (keyboardOpen && open) setOpen(false);
  }

  // A panel anchored to a visible trigger owes Escape AND an outside tap
  // (lib/surfaceStack.ts): it is not in the surface trail, so the way out has to
  // be the two ordinary ones.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (event.target instanceof Node && root.contains(event.target)) return;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  const menuOpen = createFabMenuVisible(open, keyboardOpen);

  return (
    <div
      ref={rootRef}
      className={"createFabRoot" + (keyboardOpen ? " isKeyboardHidden" : "")}
      // Hidden from the reader means hidden from a screen reader and from the
      // keyboard's own next-field key too. The tab bar beside it takes the same
      // pair for the same reason: a control that has slid off the bottom of the
      // screen must not still be a tab stop above the keyboard.
      aria-hidden={keyboardOpen || undefined}
      inert={keyboardOpen || undefined}
    >
      {menuOpen ? (
        <div className="createFabMenu" id={menuId} role="menu" aria-label="Create">
          {CREATE_FAB_ACTIONS.map((item) => (
            <Link
              key={item.action}
              role="menuitem"
              className="createFabRow"
              href={item.hrefFor(returnTo)}
              onClick={() => {
                trackEvent("create_fab_action", { action: item.action });
                // A client-side navigation leaves this component mounted, so a
                // sheet nobody closed stays painted over the destination.
                close();
              }}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className="createFab"
        data-testid="create-fab"
        aria-label="Create"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
        tabIndex={keyboardOpen ? -1 : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <Plus size={24} strokeWidth={2.25} aria-hidden="true" />
      </button>
    </div>
  );
}
