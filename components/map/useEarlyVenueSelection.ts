import { useEffect, useLayoutEffect, useRef } from "react";

export function useEarlyVenueSelection(selectVenue: (id: string) => void, cancelAutomaticCamera: () => void): void {
  const actions = useRef({ selectVenue, cancelAutomaticCamera });
  useLayoutEffect(() => {
    actions.current = { selectVenue, cancelAutomaticCamera };
  }, [selectVenue, cancelAutomaticCamera]);
  useEffect(() => {
    if (!document.querySelector(".mapEarly")) return;
    let observer: MutationObserver | undefined;
    const open = (event: Event) => {
      const id = (event as CustomEvent<unknown>).detail;
      if (typeof id !== "string" || !Array.from(document.querySelectorAll<HTMLAnchorElement>(".mapEarlyLink"))
        .some((link) => link.dataset.venueId === id)) return;
      event.preventDefault();
      observer?.disconnect();
      const focusHeading = () => {
        const sheet = Array.from(document.querySelectorAll<HTMLElement>(".venueInspector")).find((node) => node.dataset.venueId === id);
        const mobile = sheet?.closest<HTMLElement>(".mobileSharedSheet");
        const titleId = mobile?.getAttribute("aria-labelledby");
        const heading = titleId ? document.getElementById(titleId) : sheet?.querySelector<HTMLElement>(":scope > h3");
        if (!heading) return;
        heading.focus({ preventScroll: true });
        if (document.activeElement === heading) observer?.disconnect();
      };
      observer = new MutationObserver(focusHeading);
      observer.observe(document.body, { childList: true, subtree: true });
      actions.current.cancelAutomaticCamera();
      actions.current.selectVenue(id);
      focusHeading();
    };
    window.addEventListener("pubmax:early-venue-select", open);
    document.documentElement.dataset.earlyMapHandler = "ready";
    return () => {
      observer?.disconnect();
      window.removeEventListener("pubmax:early-venue-select", open);
      delete document.documentElement.dataset.earlyMapHandler;
    };
  }, []);
}
