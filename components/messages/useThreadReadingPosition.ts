"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";

type MessageAnchor = { element: HTMLElement; top: number };
type ReadingPosition = {
  scope: string | null;
  newest: boolean;
  outbox: Set<string>;
  viewportTop: number;
  anchors: MessageAnchor[];
};

function visibleAnchors(list: HTMLUListElement): MessageAnchor[] {
  const viewport = list.getBoundingClientRect();
  const anchors: MessageAnchor[] = [];
  for (const element of list.querySelectorAll<HTMLElement>(".messageRow")) {
    const rect = element.getBoundingClientRect();
    if (rect.top >= viewport.bottom) break;
    if (rect.bottom > viewport.top) anchors.push({ element, top: rect.top });
  }
  return anchors;
}

export function useThreadReadingPosition({
  listRef, scope, ready, current, history, outbox, keyboardOpen, revealedId, recovery,
}: {
  listRef: RefObject<HTMLUListElement | null>;
  scope: string | null;
  ready: boolean;
  current: boolean;
  history: readonly unknown[];
  outbox: readonly { id: string }[];
  keyboardOpen: boolean;
  revealedId: string | null;
  recovery: boolean;
}) {
  const enabled = ready && current;
  const position = useRef<ReadingPosition | null>(null);
  const scrollToNewest = useCallback(() => {
    const list = listRef.current;
    if (!list || !position.current?.newest) return;
    list.scrollTop = list.scrollHeight;
  }, [listRef]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!enabled || !list) {
      position.current = null;
      return;
    }
    const previous = position.current?.scope === scope ? position.current : null;
    const sent = outbox.some(row => !previous?.outbox.has(row.id));
    const viewportTop = list.getBoundingClientRect().top;
    if (previous && !previous.newest && !sent) {
      const anchor = previous.anchors.find(row => list.contains(row.element));
      list.scrollTop += anchor
        ? anchor.element.getBoundingClientRect().top - anchor.top
        : viewportTop - previous.viewportTop;
    }
    position.current = {
      scope,
      newest: !previous || previous.newest || sent,
      outbox: new Set(outbox.map(row => row.id)),
      viewportTop,
      anchors: [],
    };
    scrollToNewest();
    if (!position.current.newest) position.current.anchors = visibleAnchors(list);
  }, [enabled, scope, history, outbox, keyboardOpen, revealedId, recovery, listRef, scrollToNewest]);

  useEffect(() => {
    const list = listRef.current;
    if (!enabled || !list) return;
    let frame = 0;
    let height = list.clientHeight;
    const onScroll = () => {
      if (!position.current || list.clientHeight !== height) return;
      const remaining = list.scrollHeight - list.clientHeight - list.scrollTop;
      position.current.newest = remaining <= 24;
      position.current.viewportTop = list.getBoundingClientRect().top;
      position.current.anchors = position.current.newest ? [] : visibleAnchors(list);
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
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      list.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, [enabled, scope, listRef, scrollToNewest]);
}
