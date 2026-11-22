"use client";

import { useCallback, useLayoutEffect, useRef } from "react";

import {
  isTextEntryElement,
  SOFT_KEYBOARD_MIN_SHRINK_RATIO,
  readSoftKeyboardOpen,
  softKeyboardOpen,
  subscribeSoftKeyboard,
} from "@/lib/softKeyboard";

type VisibleView = { readonly top: number; readonly height: number };

const LARGE_TOUCH_SCREEN = "(min-width: 1024px) and (pointer: coarse)";

function clearPanel(panel: HTMLElement | null) {
  panel?.style.removeProperty("top");
  panel?.style.removeProperty("height");
  panel?.style.removeProperty("max-height");
  panel?.style.removeProperty("z-index");
}

function fitPanel(panel: HTMLElement, shell: HTMLElement, view: VisibleView, layoutHeight: number, panelShift: number): number {
  shell.style.removeProperty("height");
  shell.style.removeProperty("top");
  const normalTop = panel.getBoundingClientRect().top - panelShift;
  const contentResized = shell.hasAttribute("data-viewport-reduced") && window.innerHeight < layoutHeight;
  const shift = (contentResized ? view.top : Math.max(view.top, normalTop)) - normalTop;
  const nextTop = `${shift}px`;
  const maxHeight = `calc(${Math.max(0, view.top + view.height - normalTop - shift)}px - var(--messages-consent-clearance))`;
  const nextHeight = contentResized ? maxHeight : "";
  if (panel.style.top !== nextTop) panel.style.top = nextTop;
  panel.style.zIndex = shift < 0 ? "var(--z-float)" : "";
  if (panel.style.height !== nextHeight) panel.style.height = nextHeight;
  if (panel.style.maxHeight !== maxHeight) panel.style.maxHeight = maxHeight;
  return shift;
}

function fitShell(shell: HTMLElement, view: VisibleView) {
  const nextHeight = `calc(${view.height}px - var(--composer-clearance))`;
  const nextTop = `${view.top}px`;
  if (shell.style.height !== nextHeight) shell.style.height = nextHeight;
  if (shell.style.top !== nextTop) shell.style.top = nextTop;
}

function fitComposer(shell: HTMLElement, view: VisibleView) {
  shell.removeAttribute("data-compact-composer");
  const composer = shell.querySelector<HTMLElement>(".composer");
  const dock = shell.querySelector<HTMLElement>(".composerDock");
  const header = shell.querySelector<HTMLElement>(".threadHeaderGroup");
  const picker = shell.querySelector<HTMLElement>(".composerPickerRegion");
  const bounds = getComputedStyle(shell).display === "contents"
    ? shell.closest<HTMLElement>(".messagesThreadPane") : shell;
  if (!composer || !dock || !header || !bounds) return;
  const style = getComputedStyle(dock);
  const minimum = parseFloat(getComputedStyle(composer).minHeight)
    + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
    + (picker ? parseFloat(getComputedStyle(picker).minHeight) + parseFloat(style.rowGap) : 0);
  const bottom = Math.min(view.top + view.height, bounds.getBoundingClientRect().bottom
    - parseFloat(getComputedStyle(bounds).borderBottomWidth));
  shell.toggleAttribute("data-compact-composer", minimum > bottom - header.getBoundingClientRect().bottom);
}

export function useThreadViewportFit() {
  const fitViewportRef = useRef<(() => void) | null>(null);

  const attachViewport = useCallback((shell: HTMLDivElement | null) => {
    if (!shell) return;
    const viewport = window.visualViewport;
    let layoutWidth = window.innerWidth;
    let layoutHeight = window.innerHeight;
    let lowestHeight = window.visualViewport?.height ?? window.innerHeight;
    let lowestWidth = layoutWidth;
    const panel = shell.closest<HTMLElement>(".messagesSplit");
    let panelShift = 0;
    const trackKeyboard = (): number => {
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
      return height;
    };
    const fit = () => {
      // Pinch zoom changes the view, not the conversation's layout.
      if (viewport && viewport.scale !== 1) return;
      const height = trackKeyboard();
      const view = { top: viewport?.offsetTop ?? 0, height };
      if (panel && window.matchMedia(LARGE_TOUCH_SCREEN).matches) {
        panelShift = fitPanel(panel, shell, view, layoutHeight, panelShift);
      } else {
        clearPanel(panel);
        panelShift = 0;
        fitShell(shell, view);
      }
      fitComposer(shell, view);
    };
    fitViewportRef.current = fit;
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
      if (fitViewportRef.current === fit) fitViewportRef.current = null;
      clearPanel(panel);
    };
  }, []);

  useLayoutEffect(() => {
    fitViewportRef.current?.();
  });

  return { attachViewport };
}
