"use client";

import { useEffect, useRef } from "react";
import { LocateFixed, X } from "lucide-react";

import {
  dismissMapFirstVisitArrival,
  setMapFirstVisitArrivalCardVisible,
} from "@/lib/mapFirstVisitArrival";
import { buttonVariants } from "@/components/ui/button";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";

import styles from './mapArrivalCard.module.css';

/**
 * The first-visit ask, as a strip under the phone's own top bar.
 *
 * It used to be a 256px panel at the foot of the screen, over the densest part
 * of central London, and the map under it was `inert` while it was up: the
 * painted-pin probe found ZERO tappable marks anywhere on the canvas, 3 runs of
 * 3, and 32 to 41 the instant the card was dismissed (docs/proof/
 * astra-live-walk/report.md B1). A first-time reader had to shut a card before
 * the product worked.
 *
 * So it asks from the top now, the map stays live under it, and the reader's
 * own first move on the map is an answer: they came to look at pubs, which is
 * a clearer "no thanks" than the close button. PubMap owns that dismissal
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

  useEffect(() => {
    setMapFirstVisitArrivalCardVisible(true);
    return () => setMapFirstVisitArrivalCardVisible(false);
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

  useDismissOnEscape(true, dismiss);

  return (
    <aside
      ref={cardRef}
      className="mapArrivalCard"
      aria-label="First visit"
      tabIndex={-1}
    >
      <div className={styles.mapArrivalCardSay}>
        <h2 className={styles.mapArrivalCardTitle}>Cheapest pints near you?</h2>
        {/* The visible half of a pair with the iOS purpose string. See
            docs/proof/mobile-app-design/STORE_READINESS.md. */}
        <p className={styles.mapArrivalCardLead}>
          Location is used only while the map is open.
        </p>
      </div>
      <div className={styles.mapArrivalCardActions}>
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
          className={buttonVariants({ variant: "secondary" })}
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
        className={styles.mapArrivalCardClose}
        aria-label="Close"
        onClick={dismiss}
      >
        <X size={16} aria-hidden="true" />
      </button>
    </aside>
  );
}
