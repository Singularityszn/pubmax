import { useEffect, useLayoutEffect, useRef } from "react";

export function useEarlyVenueSelection(selectVenue: (id: string) => void, cancelAutomaticCamera: () => void): void {
  const actions = useRef({ selectVenue, cancelAutomaticCamera });
  useLayoutEffect(() => {
    actions.current = { selectVenue, cancelAutomaticCamera };
  }, [selectVenue, cancelAutomaticCamera]);
  useEffect(() => {
    if (!document.querySelector(".mapEarly")) return;
    let focusObserver: MutationObserver | undefined;
    let activeId = "";
    const openDetail = (): HTMLElement | null => {
      try { return document.querySelector<HTMLElement>(".mapEarlyDetail:popover-open"); }
      catch { return null; }
    };
    const focusVenue = (id: string) => {
      const sheet = Array.from(document.querySelectorAll<HTMLElement>(".venueInspector")).find((node) => node.dataset.venueId === id);
      const mobile = sheet?.closest<HTMLElement>(".mobileSharedSheet");
      const titleId = mobile?.getAttribute("aria-labelledby");
      const heading = titleId ? document.getElementById(titleId) : sheet?.querySelector<HTMLElement>(":scope > h3");
      if (!heading) return;
      heading.focus({ preventScroll: true });
      if (document.activeElement === heading) focusObserver?.disconnect();
    };
    const reconcile = () => {
      const detail = openDetail();
      const id = detail?.dataset.venueId ?? "";
      if (!detail || !id) { activeId = ""; return; }
      if (id !== activeId) {
        activeId = id;
        actions.current.cancelAutomaticCamera();
      }
      if (document.documentElement.dataset.mapPreview !== "done") return;
      activeId = "";
      if (typeof detail.hidePopover === "function") detail.hidePopover();
      focusObserver?.disconnect();
      focusObserver = new MutationObserver(() => focusVenue(id));
      focusObserver.observe(document.body, { childList: true, subtree: true });
      actions.current.selectVenue(id);
      focusVenue(id);
    };
    document.addEventListener("toggle", reconcile, true);
    const previewObserver = new MutationObserver(reconcile);
    previewObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-map-preview"] });
    document.documentElement.dataset.earlyMapHandler = "ready";
    reconcile();
    return () => {
      focusObserver?.disconnect();
      previewObserver.disconnect();
      document.removeEventListener("toggle", reconcile, true);
      delete document.documentElement.dataset.earlyMapHandler;
    };
  }, []);
}
