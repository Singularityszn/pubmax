import { MIN_ROUTE_CONTENT_PX } from "@/components/map/canvas/bottomSheetGeometry";

type Insets = { top: number; right: number; bottom: number; left: number };
const CHROME_ROWS = ".mobileMapTopbar, .mobileMapChipRow, .mobileMapSearchRow, .mobileMapQueryRow";

export function fairPintRouteInsets(container: HTMLElement, phone: boolean, padding: Insets): Insets {
  const form = document.querySelector("#fair-pint-lock-form, .fairPintResultFallback");
  if (!form) return padding;
  const sheet = form.closest<HTMLElement>(".mobileSharedSheet");
  const panel = form.closest<HTMLElement>(".fairPintResult");
  const box = container.getBoundingClientRect();
  const edge = (sheet ?? panel)?.getBoundingClientRect();
  if (!edge) return padding;
  if (!phone) return { ...padding, right: Math.max(padding.right, box.right - edge.left + 24) };
  const chrome = [...document.querySelectorAll(CHROME_ROWS)].filter((row) => {
    const style = getComputedStyle(row);
    return style.display !== "none" && style.visibility !== "hidden" && row.getBoundingClientRect().height > 0;
  });
  const top = chrome.length ? Math.max(...chrome.map((row) => row.getBoundingClientRect().bottom)) - box.top + 24 : padding.top;
  return { ...padding, top, bottom: box.bottom - edge.top + 24 };
}

export function fairPintNeedsPeek(container: HTMLElement): boolean {
  const padding = fairPintRouteInsets(container, true, { top: 0, right: 0, bottom: 0, left: 0 });
  return container.getBoundingClientRect().height - padding.top - padding.bottom < MIN_ROUTE_CONTENT_PX;
}
