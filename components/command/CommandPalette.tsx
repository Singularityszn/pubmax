"use client";

// The ⌘K palette dialog (feature N1). Mounted only while open (the provider
// conditionally renders it). Its query starts empty. The strict-modal focus
// trap releases inert before restoring the opener when the dialog unmounts.
//
// Accessibility: a combobox-over-listbox pattern. Focus stays on the input
// during arrow navigation. The active row uses aria-activedescendant rather
// than moving DOM focus. Tab stays inside the dialog. Esc closes, ↑/↓ move
// the active row, Enter runs it. Backdrop click closes.
// Entrance motion is gated behind prefers-reduced-motion in the CSS.

import { useCallback, useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";

import { useSocialSurfaceName } from "@/lib/useSocialFriendsLaunch";
import { useFocusTrap } from "@/lib/useFocusTrap";

import { commands } from "./commands";
import { filterCommands } from "./commandFilter";
import type { Command, CommandContext, CommandGroup } from "./types";

import "./commandPalette.css";

// Flip light ↔ dark exactly the way ThemeToggle does (attribute on <html> +
// persisted choice), so the palette's "Toggle theme" stays in sync with the nav
// toggle and survives reloads via the no-flash init script.
function toggleTheme(): void {
  if (typeof document === "undefined") return;
  const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("pubmax-theme", next);
  } catch {
    // Private-mode / storage-disabled: the attribute flip still applies for the
    // session; persistence is best-effort.
  }
}

export default function CommandPalette({
  onClose,
  panelRef: providedPanelRef,
}: {
  onClose: () => void;
  panelRef?: RefObject<HTMLDivElement | null>;
}): React.JSX.Element {
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const ownPanelRef = useRef<HTMLDivElement>(null);
  const panelRef = providedPanelRef ?? ownPanelRef;
  useFocusTrap(true, panelRef, "strict-modal");
  const rowRefs = useRef<Record<string, HTMLElement | null>>({});

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const socialLabel = useSocialSurfaceName();

  const paletteCommands = useMemo(
    () =>
      commands.map((command) =>
        command.id === "nav-social"
          ? { ...command, label: socialLabel }
          : command,
      ),
    [socialLabel],
  );

  // Filter, then re-group so each section's rows are contiguous under a single
  // header while still honouring the pure filter's ranking within a group.
  const ordered = useMemo(() => {
    const matches = filterCommands(paletteCommands, query);
    const groups: CommandGroup[] = [];
    for (const cmd of matches) if (!groups.includes(cmd.group)) groups.push(cmd.group);
    return groups.flatMap((group) => matches.filter((cmd) => cmd.group === group));
  }, [paletteCommands, query]);

  // Precompute a header flag per row (groups are contiguous, so a header shows
  // only on the first row of each group) — keeps the render branch-free.
  const rows = useMemo(
    () =>
      ordered.map((command, index) => ({
        command,
        header: index === 0 || command.group !== ordered[index - 1]!.group ? command.group : null,
      })),
    [ordered],
  );

  // Clamp defensively — the active index is reset to 0 on every keystroke, but
  // this guards the render if `ordered` shrinks for any other reason.
  const activeSafe = ordered.length === 0 ? -1 : Math.min(activeIndex, ordered.length - 1);
  const activeCommand = activeSafe >= 0 ? ordered[activeSafe] : undefined;
  const activeOptionId = activeCommand ? `${listId}-${activeCommand.id}` : undefined;

  // The shared strict-modal owner restores the opener after releasing inert.
  // This effect only moves initial typing focus into the dialog.
  useEffect(() => {
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(raf);
    };
  }, []);

  // Keep the active row visible as it moves off-screen (DOM read/scroll only).
  useEffect(() => {
    if (!activeCommand) return;
    rowRefs.current[activeCommand.id]?.scrollIntoView({ block: "nearest" });
  }, [activeCommand]);

  const runCommand = useCallback(
    (command: Command) => {
      const ctx: CommandContext = {
        navigate: (href) => {
          // Planner arrival is read at mount, including when the map is open.
          if (href === "/map?mode=build&plan=1" && window.location.pathname.startsWith("/map")) {
            window.location.assign(href);
            return;
          }
          // Reopening the mounted map's picker must retain its camera and GPS
          // fix. Native history publishes the query to useSearchParams without
          // making a route request that can replace the map's document.
          if (href === "/map?log=1" && window.location.pathname === "/map") {
            window.history.pushState(null, "", href);
            return;
          }
          router.push(href);
        },
        close: onClose,
        toggleTheme,
      };
      onClose();
      command.run(ctx);
    },
    [router, onClose],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setActiveIndex((i) => (ordered.length === 0 ? 0 : Math.min(i + 1, ordered.length - 1)));
          break;
        case "ArrowUp":
          event.preventDefault();
          setActiveIndex((i) => Math.max(i - 1, 0));
          break;
        case "Home":
          event.preventDefault();
          setActiveIndex(0);
          break;
        case "End":
          event.preventDefault();
          setActiveIndex(Math.max(ordered.length - 1, 0));
          break;
        case "Enter":
          event.preventDefault();
          if (activeCommand) runCommand(activeCommand);
          break;
        case "Escape":
          event.preventDefault();
          onClose();
          break;
        case "Tab":
          // Trap focus: only the input is focusable, so keep it here.
          event.preventDefault();
          break;
        default:
          break;
      }
    },
    [ordered.length, activeCommand, runCommand, onClose],
  );

  const onBackdropMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (event.target !== event.currentTarget) return;
      event.preventDefault();
      onClose();
    },
    [onClose],
  );

  return (
    <div className="cmdkBackdrop" role="presentation" onMouseDown={onBackdropMouseDown}>
      <div
        ref={panelRef}
        className="cmdkPanel"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={onKeyDown}
      >
        <div className="cmdkInputRow">
          <input
            ref={inputRef}
            className="cmdkInput"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={activeOptionId}
            aria-label="Search commands"
            placeholder="Search commands or jump to a page…"
            value={query}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
          />
          <kbd className="cmdkEscHint" aria-hidden="true">
            Esc
          </kbd>
        </div>

        <ul className="cmdkList" id={listId} role="listbox" aria-label="Commands">
          {rows.length === 0 ? (
            <li className="cmdkEmpty" role="presentation">
              No matches
            </li>
          ) : (
            rows.map(({ command, header }, index) => {
              const isActive = index === activeSafe;
              return (
                <li className="cmdkGroupChunk" key={command.id} role="presentation">
                  {header ? (
                    <div className="cmdkGroupHeader" role="presentation">
                      {header}
                    </div>
                  ) : null}
                  <div
                    ref={(el) => {
                      rowRefs.current[command.id] = el;
                    }}
                    id={`${listId}-${command.id}`}
                    role="option"
                    aria-selected={isActive}
                    className={isActive ? "cmdkRow isActive" : "cmdkRow"}
                    // Keep focus on the input when a row is clicked/hovered.
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseMove={() => setActiveIndex(index)}
                    onClick={() => runCommand(command)}
                  >
                    <span className="cmdkRowLabel">{command.label}</span>
                    {command.hint ? <span className="cmdkRowHint">{command.hint}</span> : null}
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
