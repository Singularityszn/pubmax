import { useCallback, useState } from "react";

import { buildVenueShareText } from "@/lib/shareArtifacts";
import { shareNightObject } from "@/lib/shareSheet";
import { venueMapUrl } from "@/lib/venueMapUrl";
import type { ShareFeedback } from "@/lib/venueShare";
import type { Venue } from "@/lib/venues";

export function useVenueShare(venue: Venue) {
  const [shareFeedback, setShareFeedback] = useState<ShareFeedback | null>(null);
  const currentShareFeedback =
    shareFeedback?.venueId === venue.id ? shareFeedback : null;

  const shareVenue = useCallback(async () => {
    if (typeof window === "undefined") return;
    const url = new URL(venueMapUrl(venue.id), window.location.origin).toString();
    const title = venue.name;
    const setShareStatus = (tone: ShareFeedback["tone"], text: string) => {
      setShareFeedback({ venueId: venue.id, tone, text });
    };

    setShareFeedback(null);
    // Native sheet first, wa.me fallback — the shared night-object flow.
    const outcome = await shareNightObject({
      title,
      text: buildVenueShareText({ name: title, cheapestPintGbp: venue.cheapestPrice }),
      url,
    });
    if (outcome === "shared" || outcome === "cancelled") return;
    if (outcome === "whatsapp") {
      setShareStatus("ok", "Opened WhatsApp to share the link.");
      return;
    }
    // Neither the sheet nor WhatsApp worked — last resort is the clipboard.
    const nav = typeof navigator === "undefined" ? undefined : navigator;
    if (!nav?.clipboard?.writeText) {
      setShareStatus("error", "Sharing and clipboard are unavailable. Copy the page URL.");
      return;
    }
    try {
      await nav.clipboard.writeText(url);
      setShareStatus("ok", "Share failed, but the link was copied.");
    } catch {
      setShareStatus("error", "Couldn't copy the link. Copy it from your browser bar.");
    }
  }, [venue.id, venue.name, venue.cheapestPrice]);

  return { currentShareFeedback, shareVenue };
}
