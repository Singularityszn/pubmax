"use client";

// Global owner of the ⌘K command palette (feature N1). Mounts once at the root
// (app/layout.tsx), owns open/close state, binds the global ⌘K / Ctrl+K
// shortcut (and Esc while open), and exposes an imperative open/close/toggle
// API via context so any client component (e.g. SiteNav's ⌘K affordance) can
// open the palette. The provider owns dismissal while the dialog chunk loads,
// so Escape can cancel an opening request before the dialog mounts.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";

import { useDismissOnEscape } from "@/lib/useDismissOnEscape";
import { readOtherStrictModalFocusTrap, serverStrictModalFocusTrap, subscribeStrictModalFocusTrap } from "@/lib/useFocusTrap";

// The dialog is fetched when it first opens, not when the app boots. This
// provider is mounted at the root on EVERY route, so a static import put the
// palette, its command table, its filter and its stylesheet into the shared
// shell that a phone downloads to read the landing - for an affordance a phone
// has no key to reach. The opening request loads the chunk. A strict modal
// cancels that request so the palette cannot steal focus when loading finishes.
const CommandPalette = dynamic(() => import("./CommandPalette"), {
  ssr: false,
  loading: () => null,
});

type CommandPaletteApi = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
};

// Inert fallback so a component that reads the hook while rendered outside the
// provider (isolated tests, storybook, etc.) never crashes — the palette simply
// can't be opened there.
const NOOP_API: CommandPaletteApi = {
  isOpen: false,
  open: () => {},
  close: () => {},
  toggle: () => {},
};

const CommandPaletteContext = createContext<CommandPaletteApi | null>(null);

/** Imperative handle onto the global palette (open/close/toggle + isOpen). */
export function useCommandPalette(): CommandPaletteApi {
  return useContext(CommandPaletteContext) ?? NOOP_API;
}

export default function CommandPaletteProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const otherStrictModalOpen = useSyncExternalStore(
    subscribeStrictModalFocusTrap,
    () => readOtherStrictModalFocusTrap(panelRef.current),
    serverStrictModalFocusTrap,
  );
  // Cancel a pending lazy palette when another modal takes the page. Holding
  // the request would open it later and steal that modal's typing focus.
  if (isOpen && otherStrictModalOpen) setIsOpen(false);

  const open = useCallback(() => {
    if (!readOtherStrictModalFocusTrap(panelRef.current)) setIsOpen(true);
  }, []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => {
    if (!readOtherStrictModalFocusTrap(panelRef.current)) setIsOpen((v) => !v);
  }, []);
  // Own Back from the initial request through the lazy dialog's lifetime.
  useDismissOnEscape(isOpen && !otherStrictModalOpen, close, panelRef, true);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // ⌘K (mac) / Ctrl+K (win/linux) always toggles — even from inside an
      // input — and we preventDefault so the browser's own ⌘K doesn't fire.
      const isPaletteKey =
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        (event.key === "k" || event.key === "K");
      if (isPaletteKey) {
        event.preventDefault();
        toggle();
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  const api = useMemo<CommandPaletteApi>(
    () => ({ isOpen, open, close, toggle }),
    [isOpen, open, close, toggle],
  );

  return (
    <CommandPaletteContext.Provider value={api}>
      {children}
      {isOpen && !otherStrictModalOpen ? <CommandPalette onClose={close} panelRef={panelRef} /> : null}
    </CommandPaletteContext.Provider>
  );
}
