"use client";

import { LogOut, MoreHorizontal, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { GROUP_LEAVE_LABEL } from "@/lib/messageGroupThread";
import { CHAT_DELETE_LABEL } from "@/lib/messageRemovals";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";

import "./messageThreadActions.css";

/**
 * The thread head's one menu: delete the chat, and leave a group. Each item
 * only asks; the confirm is the thread's, so this holds no request of its own.
 */
export default function MessageThreadMenu({
  isGroup,
  onDeleteChat,
  onLeaveGroup,
}: {
  isGroup: boolean;
  onDeleteChat: () => void;
  onLeaveGroup: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) toggleRef.current?.focus({ preventScroll: true });
  };
  useDismissOnEscape(open, () => close(true));

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus({
      preventScroll: true,
    });
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [
      ...(listRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? []),
    ];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    items[(at + step + items.length) % items.length]?.focus();
  };

  const choose = (run: () => void) => {
    close(true);
    run();
  };

  return (
    <div className="threadMenu" ref={rootRef}>
      <button
        ref={toggleRef}
        type="button"
        className="threadMenuToggle"
        aria-label="Chat options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <MoreHorizontal size={20} aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={listRef}
          className="threadMenuList"
          role="menu"
          aria-label="Chat options"
          onKeyDown={moveFocus}
        >
          <button
            type="button"
            role="menuitem"
            className="threadMenuItem"
            onClick={() => choose(onDeleteChat)}
          >
            <Trash2 size={16} aria-hidden="true" />
            {CHAT_DELETE_LABEL}
          </button>
          {isGroup ? (
            <button
              type="button"
              role="menuitem"
              className="threadMenuItem"
              onClick={() => choose(onLeaveGroup)}
            >
              <LogOut size={16} aria-hidden="true" />
              {GROUP_LEAVE_LABEL}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
