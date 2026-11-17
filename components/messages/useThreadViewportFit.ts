"use client";

import { useCallback, useLayoutEffect, useRef } from "react";

import type { MessageDTO } from "@/lib/messages";
import {
  isTextEntryElement,
  SOFT_KEYBOARD_MIN_SHRINK_RATIO,
  readSoftKeyboardOpen,
  softKeyboardOpen,
  subscribeSoftKeyboard,
} from "@/lib/softKeyboard";

export function useThreadViewportFit({
  conversationId,
  accountRevision,
  messages,
  outbox,
  revealedId,
}: {
  conversationId: string;
  accountRevision: number;
  messages: readonly MessageDTO[];
  outbox: readonly MessageDTO[];
  revealedId: string | null;
}) {
  const listRef = useRef<HTMLUListElement | null>(null);
  const followingNewestRef = useRef(true);

  const attachViewport = useCallback((shell: HTMLDivElement | null) => {
    if (!shell) return;
    const viewport = window.visualViewport;
    let layoutWidth = window.innerWidth;
    let layoutHeight = window.innerHeight;
    let lowestHeight = window.visualViewport?.height ?? window.innerHeight;
    let lowestWidth = layoutWidth;
    const panel = shell.closest<HTMLElement>(".messagesSplit");
    let panelShift = 0;
    const fit = () => {
      // Pinch zoom changes the view, not the conversation's layout.
      if (viewport && viewport.scale !== 1) return;
      const focused = isTextEntryElement(document.activeElement);
      const wasReduced = shell.hasAttribute("data-viewport-reduced");
      const height = viewport?.height ?? window.innerHeight;
      lowestHeight = window.innerWidth === lowestWidth ? Math.min(lowestHeight, height) : height;
      lowestWidth = window.innerWidth;
      const recovered = height - lowestHeight >= Math.max(height, layoutHeight) * SOFT_KEYBOARD_MIN_SHRINK_RATIO;
      if (window.innerWidth !== layoutWidth && ((!wasReduced && !readSoftKeyboardOpen()) || recovered)) {
        layoutWidth = window.innerWidth;
        layoutHeight = window.innerHeight;
        lowestHeight = height;
      }
      if (!focused && !wasReduced) layoutHeight = window.innerHeight;
      layoutHeight = Math.max(layoutHeight, window.innerHeight);
      shell.toggleAttribute("data-viewport-reduced", readSoftKeyboardOpen() || (wasReduced && softKeyboardOpen({
        textEntryFocused: true,
        visualViewportHeight: viewport?.height ?? window.innerHeight,
        layoutViewportHeight: layoutHeight,
      })));
      const top = viewport?.offsetTop ?? 0;
      if (panel && window.matchMedia("(min-width: 1024px) and (pointer: coarse)").matches) {
        shell.style.removeProperty("height");
        shell.style.removeProperty("top");
        const normalTop = panel.getBoundingClientRect().top - panelShift;
        const contentResized = shell.hasAttribute("data-viewport-reduced") && window.innerHeight < layoutHeight;
        panelShift = (contentResized ? top : Math.max(top, normalTop)) - normalTop;
        const nextTop = `${panelShift}px`;
        const maxHeight = `calc(${Math.max(0, top + height - normalTop - panelShift)}px - var(--messages-consent-clearance))`;
        const nextHeight = contentResized ? maxHeight : "";
        if (panel.style.top !== nextTop) panel.style.top = nextTop;
        panel.style.zIndex = panelShift < 0 ? "var(--z-float)" : "";
        if (panel.style.height !== nextHeight) panel.style.height = nextHeight;
        if (panel.style.maxHeight !== maxHeight) panel.style.maxHeight = maxHeight;
      } else {
        panel?.style.removeProperty("top");
        panel?.style.removeProperty("height");
        panel?.style.removeProperty("max-height");
        panel?.style.removeProperty("z-index");
        panelShift = 0;
        const nextHeight = `calc(${height}px - var(--composer-clearance))`;
        const nextTop = `${top}px`;
        if (shell.style.height !== nextHeight) shell.style.height = nextHeight;
        if (shell.style.top !== nextTop) shell.style.top = nextTop;
      }
    };
    fit();
    const unsubscribe = subscribeSoftKeyboard(fit);
    viewport?.addEventListener("resize", fit);
    viewport?.addEventListener("scroll", fit);
    window.addEventListener("resize", fit);
    return () => {
      unsubscribe();
      viewport?.removeEventListener("resize", fit);
      viewport?.removeEventListener("scroll", fit);
      window.removeEventListener("resize", fit);
      panel?.style.removeProperty("top");
      panel?.style.removeProperty("height");
      panel?.style.removeProperty("max-height");
      panel?.style.removeProperty("z-index");
    };
  }, []);

  const scrollToNewest = useCallback(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, []);

  useLayoutEffect(() => {
    followingNewestRef.current = true;
  }, [conversationId, accountRevision]);

  useLayoutEffect(() => {
    if (followingNewestRef.current) scrollToNewest();
  }, [messages, outbox, revealedId, scrollToNewest]);

  const attachList = useCallback((list: HTMLUListElement | null) => {
    listRef.current = list;
    if (!list) return;
    if (followingNewestRef.current) scrollToNewest();
    let height = list.clientHeight;
    const onScroll = () => {
      // Resizing can emit a scroll before ResizeObserver restores the pinned edge.
      if (list.clientHeight !== height) return;
      followingNewestRef.current = list.scrollHeight - list.scrollTop - height <= 2;
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      height = list.clientHeight;
      if (followingNewestRef.current) scrollToNewest();
    });
    list.addEventListener("scroll", onScroll, { passive: true });
    observer?.observe(list);
    return () => {
      list.removeEventListener("scroll", onScroll);
      observer?.disconnect();
      if (listRef.current === list) listRef.current = null;
    };
  }, [scrollToNewest]);

  return { attachViewport, attachList, followingNewestRef };
}
