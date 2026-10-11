import type { MapSheetDetent } from "@/lib/mobileShell";

/** Half and full engage map-surface focus handling, including visible exempt controls. */
export function mobileSheetFocusContained(snap: MapSheetDetent): boolean {
  return snap === "half" || snap === "full";
}

/**
 * This legacy name controls scrim and dialog presentation, not ARIA modality.
 * MobileSharedSheet owns the dialog attributes. useFocusTrap owns exemptions.
 */
export function mobileSheetIsModal(snap: MapSheetDetent): boolean {
  return mobileSheetFocusContained(snap);
}
