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
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      const nextWidth = field.clientWidth;
      if (nextWidth === width) return;
      width = nextWidth;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    });
    observer?.observe(field);
    const attributes = new MutationObserver(measure);
    attributes.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class", "data-theme"] });
    attributes.observe(document.body, { attributes: true, attributeFilter: ["style", "class"] });
    window.addEventListener("resize", measure);
    document.fonts?.addEventListener("loadingdone", measure);
    document.fonts?.addEventListener("loadingerror", measure);
    void document.fonts?.ready.then(measure);
    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      attributes.disconnect();
      window.removeEventListener("resize", measure);
      document.fonts?.removeEventListener("loadingdone", measure);
      document.fonts?.removeEventListener("loadingerror", measure);
    };
  }, [field]);

  return setField;
}
