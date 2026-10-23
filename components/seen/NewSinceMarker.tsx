import { NEW_SINCE_LABEL, NEW_SINCE_SR_SUFFIX } from "@/lib/seenSinceLastLook";

import "./newSinceMarker.css";

/**
 * The "New" mark on a row this device has not been shown before
 * (lib/seenSinceLastLook.ts). The word carries the meaning; the dot beside it
 * is decorative and hidden from assistive technology, which hears "New since
 * your last visit".
 */
export default function NewSinceMarker({ className }: { className?: string }) {
  return (
    <span className={["newSinceMarker", className].filter(Boolean).join(" ")} data-testid="new-since-marker">
      <span className="newSinceMarkerDot" aria-hidden="true" />
      {NEW_SINCE_LABEL}
      <span className="newSinceMarkerSr">{NEW_SINCE_SR_SUFFIX}</span>
    </span>
  );
}
