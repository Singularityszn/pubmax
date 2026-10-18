import * as maplibregl from "maplibre-gl";

import { palGenomeFor, palGenomeStyle } from "@/lib/palGenome";
import { pubPalMascotSlugFor, pubPalMascotSrc } from "@/lib/pubPalMascot";
import type { PubPal } from "@/lib/pubPal";
import { safeLocalStorage } from "@/lib/safeStorage";
import "./palMarker.css";

// The Pal on the map: the reader's own Pub Pal perched beside the pub they
// have open.
//
// It is ONE DOM marker, the same bounded-count exception the donut clusters
// take (donutClusters.ts), and it keeps to the map's rules:
// - it never moves the camera ("Nothing moves this camera but the reader"):
//   it only appears where the reader is already looking, beside the selected
//   pin, and hops when the selection changes;
// - it sits up and to the right of the pin, never over it, and takes no
//   pointer events, so every pin under it stays tappable and the painted-pin
//   probe still finds the pin it names;
// - it is the Pal's rendered avatar held by its genome (lib/palGenome.ts),
//   never a drawing, and it is decorative, so assistive tech skips it;
// - with no Pal, or a Pal the reader hid, it is never made.

const PAL_STORAGE_KEY = "pubmax_pub_pal_v1";
const MARKER_PX = 38;

export type PalMapMarker = {
  /** Perch beside this point, or step off the map with null. */
  perch: (lngLat: [number, number] | null) => void;
  destroy: () => void;
};

const NO_PAL: PalMapMarker = { perch: () => {}, destroy: () => {} };

function storedPal(): PubPal | null {
  try {
    const raw = safeLocalStorage()?.getItem(PAL_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PubPal> | null;
    if (!value || typeof value !== "object" || !value.id || !value.appearance) return null;
    return value as PubPal;
  } catch {
    return null;
  }
}

/** The marker's markup, as plain DOM: the map's markers live outside React. */
export function palMarkerElement(pal: PubPal): HTMLElement | null {
  const slug = pubPalMascotSlugFor(pal.appearance.species);
  if (!slug) return null;
  const element = document.createElement("div");
  element.className = "palMapMarker";
  element.setAttribute("aria-hidden", "true");
  if (pal.muted) element.dataset.palState = "sleeping";
  const body = document.createElement("span");
  body.className = "palMapMarkerBody";
  for (const [name, value] of Object.entries(palGenomeStyle(palGenomeFor(pal.id, pal.personality)))) {
    body.style.setProperty(name, value);
  }
  const image = document.createElement("img");
  image.src = pubPalMascotSrc(slug, "avatar", 64, "webp");
  image.alt = "";
  image.width = MARKER_PX;
  image.height = MARKER_PX;
  image.decoding = "async";
  image.draggable = false;
  body.append(image);
  element.append(body);
  return element;
}

export function createPalMapMarker(map: maplibregl.Map): PalMapMarker {
  const pal = storedPal();
  if (!pal || pal.hidden) return NO_PAL;
  const element = palMarkerElement(pal);
  if (!element) return NO_PAL;

  let marker: maplibregl.Marker | null = null;
  let perchedAt: string | null = null;

  const hop = () => {
    // Restart the landing hop: a reflow between removing and adding the class.
    element.classList.remove("isLanding");
    void element.offsetWidth;
    element.classList.add("isLanding");
  };

  return {
    perch: (lngLat) => {
      if (!lngLat) {
        marker?.remove();
        marker = null;
        perchedAt = null;
        return;
      }
      const key = `${lngLat[0].toFixed(6)},${lngLat[1].toFixed(6)}`;
      if (key === perchedAt) return;
      perchedAt = key;
      if (!marker) {
        marker = new maplibregl.Marker({ element, anchor: "bottom-left", offset: [14, -12] })
          .setLngLat(lngLat)
          .addTo(map);
      } else {
        marker.setLngLat(lngLat);
      }
      hop();
    },
    destroy: () => {
      marker?.remove();
      marker = null;
      perchedAt = null;
    },
  };
}
