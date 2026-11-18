"use client";

import { useLayoutEffect, useState } from "react";

function resize(field: HTMLTextAreaElement) {
  field.style.height = "auto";
  field.style.height = `${field.scrollHeight}px`;
}

export function useMessageInputSize(draft: string) {
  const [field, setField] = useState<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    if (field) resize(field);
  }, [field, draft]);

  useLayoutEffect(() => {
    if (!field) return;
    let active = true;
    let frame = 0;
    let width = field.clientWidth;
    const measure = () => { if (active) resize(field); };
    const scheduleMeasure = () => {
      if (!active) return;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      const nextWidth = field.clientWidth;
      if (nextWidth === width) return;
      width = nextWidth;
      scheduleMeasure();
    });
    observer?.observe(field);
    const attributes = new MutationObserver(scheduleMeasure);
    attributes.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class", "data-theme"] });
    attributes.observe(document.body, { attributes: true, attributeFilter: ["style", "class"] });
    window.addEventListener("resize", scheduleMeasure);
    document.fonts?.addEventListener("loadingdone", scheduleMeasure);
    document.fonts?.addEventListener("loadingerror", scheduleMeasure);
    void document.fonts?.ready.then(scheduleMeasure);
    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      attributes.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      document.fonts?.removeEventListener("loadingdone", scheduleMeasure);
      document.fonts?.removeEventListener("loadingerror", scheduleMeasure);
    };
  }, [field]);

  return setField;
}
