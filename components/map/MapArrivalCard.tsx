"use client";

import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { LocateFixed, X } from "lucide-react";

import {
  dismissMapFirstVisitArrival,
  setMapFirstVisitArrivalCardVisible,
} from "@/lib/mapFirstVisitArrival";
import { buttonVariants } from "@/components/ui/button";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";

import "./mapArrivalCard.css";

/**
 * The first-visit ask: a compact pill low over the map on a phone, a strip
 * under the toolbar on a desktop.
 *
 * It used to be a 256px panel at the foot of the screen, over the densest part
 * of central London, and the map under it was `inert` while it was up: the
 * painted-pin probe found ZERO tappable marks anywhere on the canvas, 3 runs of
 * 3, and 32 to 41 the instant the card was dismissed (docs/proof/
 * astra-live-walk/report.md B1). A first-time reader had to shut a card before
 * the product worked.
 *
 * So the map stays live under the ask now, and the reader's own first move on
 * the map is an answer: they came to look at pubs, which is a clearer "no
 * thanks" than the close button. PubMap owns that dismissal
 * (`dismissMapFirstVisitArrivalOnMapUse`), because the gesture and the pin tap
 * both arrive there.
 */
export default function MapArrivalCard({
  onUseLocation,
  onChooseArea,
  onDismiss,
}: {
  onUseLocation: () => void;
  onChooseArea: () => void;
  onDismiss?: () => void;
}) {
  const cardRef = useRef<HTMLElement | null>(null);
  const leadId = useId();

  useEffect(() => {
    setMapFirstVisitArrivalCardVisible(true);
    return () => setMapFirstVisitArrivalCardVisible(false);
  }, []);

  useLayoutEffect(() => {
    const node = cardRef.current;
    const shell = node?.closest<HTMLElement>(".appShell");
    if (!node || !shell) return;
    const tablet = window.matchMedia("(min-width: 641px) and (max-width: 900px)");
    const property = "--map-arrival-occupied-height";
    let published = "";
    const clear = () => {
      if (published && shell.style.getPropertyValue(property) === published) shell.style.removeProperty(property);
      published = "";
    };
    const sync = () => {
      const height = node.getBoundingClientRect().height;
      if (!tablet.matches || node.getClientRects().length === 0 || height <= 0) {
        clear();
        return;
      }
      published = `${Math.ceil(height)}px`;
      shell.style.setProperty(property, published);
    };
    sync();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    observer?.observe(node);
    tablet.addEventListener("change", sync);
    return () => {
      observer?.disconnect();
      tablet.removeEventListener("change", sync);
      clear();
    };
  }, []);

  // A live region announces a CHANGE to content already on screen. This strip
  // arrives whole, with its actions on it, so it is a labelled landmark that
  // takes focus once instead. It only takes focus nobody else holds: it lands
  // a second or two after paint, and pulling a caret out of a field somebody
  // is already typing in would be worse than saying nothing.
  useEffect(() => {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    cardRef.current?.focus();
  }, []);

  const dismiss = () => {
    dismissMapFirstVisitArrival();
    onDismiss?.();
  };

  useDismissOnEscape(true, dismiss, cardRef);

  return (
    <aside
      ref={cardRef}
      className="mapArrivalCard"
      aria-label="First visit"
      aria-describedby={leadId}
      tabIndex={-1}
    >
      <div className="mapArrivalCardSay">
        <h2 className="mapArrivalCardTitle">Cheapest pints near you?</h2>
        {/* The visible half of a pair with the iOS purpose string. See
            docs/proof/mobile-app-design/STORE_READINESS.md. */}
        <p id={leadId} className="mapArrivalCardLead">
          Location is used only while the map is open.
        </p>
      </div>
      <div className="mapArrivalCardActions">
        <button
          type="button"
          className={buttonVariants({ variant: "primary" })}
          data-primary-action=""
          onClick={() => {
            dismissMapFirstVisitArrival();
            onUseLocation();
          }}
        >
          <LocateFixed size={16} aria-hidden="true" /> Use my location
        </button>
        <button
          type="button"
          className={`${buttonVariants({ variant: "secondary" })} mapArrivalCardChooseArea`}
          onClick={() => {
            dismissMapFirstVisitArrival();
            onChooseArea();
          }}
        >
          Choose an area
        </button>
      </div>
      <button
        type="button"
        className="mapArrivalCardClose"
        aria-label="Close"
        onClick={dismiss}
      >
        <X size={16} aria-hidden="true" />
      </button>
    </aside>
  );
}
