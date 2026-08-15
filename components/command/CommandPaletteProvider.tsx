"use client";

// Global owner of the ⌘K command palette (feature N1). Mounts once at the root
// (app/layout.tsx), owns open/close state, binds the global ⌘K / Ctrl+K
// shortcut (and Esc while open), and exposes an imperative open/close/toggle
// API via context so any client component (e.g. SiteNav's ⌘K affordance) can
// pop the palette. The dialog itself is only rendered while open, so "open"
// state and "mounted" stay identical — see CommandPalette.tsx.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import {
  readStrictModalFocusTrap,
  readStrictModalFocusTrapRevision,
  serverStrictModalFocusTrap,
  serverStrictModalFocusTrapRevision,
  strictModalAllowsSurfaceRequest,
  subscribeStrictModalFocusTrap,
} from "@/lib/useFocusTrap";

import CommandPalette from "./CommandPalette";

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
  const strictModalOpen = useSyncExternalStore(
    subscribeStrictModalFocusTrap,
    readStrictModalFocusTrap,
    serverStrictModalFocusTrap,
  );
  const strictModalRevision = useSyncExternalStore(
    subscribeStrictModalFocusTrap,
    readStrictModalFocusTrapRevision,
    serverStrictModalFocusTrapRevision,
  );
  const [openRequestRevision, setOpenRequestRevision] = useState<number | null>(null);
  const isOpen = strictModalAllowsSurfaceRequest({
    requestRevision: openRequestRevision,
    strictModalActive: strictModalOpen,
    strictModalRevision,
  });

  const open = useCallback(() => {
    if (!strictModalOpen) setOpenRequestRevision(strictModalRevision);
  }, [strictModalOpen, strictModalRevision]);
  const close = useCallback(() => setOpenRequestRevision(null), []);
  const toggle = useCallback(() => {
    if (strictModalOpen) return;
    setOpenRequestRevision((revision) =>
      revision === strictModalRevision ? null : strictModalRevision,
    );
  }, [strictModalOpen, strictModalRevision]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // ⌘K (mac) / Ctrl+K (win/linux) toggles from ordinary surfaces, even
      // inside an input, and prevents the browser's own ⌘K action.
      const isPaletteKey =
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        (event.key === "k" || event.key === "K");
      if (isPaletteKey) {
        event.preventDefault();
        if (strictModalOpen) return;
        setOpenRequestRevision((revision) =>
          revision === strictModalRevision ? null : strictModalRevision,
        );
        return;
      }
      // Esc closes when open (the dialog also handles this locally; both are
      // idempotent). Left as a global safety net.
      if (event.key === "Escape") {
        setOpenRequestRevision(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [strictModalOpen, strictModalRevision]);

  const api = useMemo<CommandPaletteApi>(
    () => ({ isOpen, open, close, toggle }),
    [isOpen, open, close, toggle],
  );

  return (
    <CommandPaletteContext.Provider value={api}>
      {children}
      {isOpen ? <CommandPalette onClose={close} /> : null}
    </CommandPaletteContext.Provider>
  );
}
