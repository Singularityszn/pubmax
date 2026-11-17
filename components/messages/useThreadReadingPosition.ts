"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";

type ReadingPosition = { scope: string | null; newest: boolean; outbox: Set<string> };

export function useThreadReadingPosition({
  listRef, scope, ready, current, history, outbox, keyboardOpen, recovery,
}: {
  listRef: RefObject<HTMLUListElement | null>;
  scope: string | null;
  ready: boolean;
  current: boolean;
  history: readonly unknown[];
  outbox: readonly { id: string }[];
  keyboardOpen: boolean;
  recovery: boolean;
}) {
  const enabled = ready && current;
  const position = useRef<ReadingPosition | null>(null);
  const scrollToNewest = useCallback(() => {
    const list = listRef.current;
    if (!list || !position.current?.newest) return;
    if (getComputedStyle(list).overflowY === "auto") {
      list.scrollTop = list.scrollHeight;
    } else if (document.documentElement.scrollHeight > window.innerHeight) {
      window.scrollTo({ top: document.documentElement.scrollHeight });
    }
  }, [listRef]);

  useLayoutEffect(() => {
    if (!enabled || !listRef.current) {
      position.current = null;
      return;
    }
    const previous = position.current?.scope === scope ? position.current : null;
    const sent = outbox.some(row => !previous?.outbox.has(row.id));
    position.current = {
      scope,
      newest: !previous || previous.newest || sent,
      outbox: new Set(outbox.map(row => row.id)),
    };
    scrollToNewest();
  }, [enabled, scope, history, outbox, keyboardOpen, recovery, listRef, scrollToNewest]);

  useEffect(() => {
    const list = listRef.current;
    if (!enabled || !list) return;
    let frame = 0;
    let height = list.clientHeight;
    const onScroll = () => {
      if (!position.current || list.clientHeight !== height) return;
      const remaining = getComputedStyle(list).overflowY === "auto"
        ? list.scrollHeight - list.clientHeight - list.scrollTop
        : document.documentElement.scrollHeight - window.innerHeight - window.scrollY;
      position.current.newest = remaining <= 24;
    };
    const onResize = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(scrollToNewest);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      height = list.clientHeight;
      scrollToNewest();
    });
    observer?.observe(list);
    list.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      list.removeEventListener("scroll", onScroll);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, [enabled, scope, listRef, scrollToNewest]);
}
