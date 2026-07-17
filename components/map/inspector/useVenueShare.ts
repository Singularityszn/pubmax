import { useCallback, useState } from "react";

import { buildVenueShareText } from "@/lib/shareArtifacts";
import { venueMapUrl } from "@/lib/venueMapUrl";
import { isUserCancelledShare, type ShareFeedback } from "@/lib/venueShare";
import type { Venue } from "@/lib/venues";

export function useVenueShare(venue: Venue) {
  const [shareFeedback, setShareFeedback] = useState<ShareFeedback | null>(null);
  const currentShareFeedback =
    shareFeedback?.venueId === venue.id ? shareFeedback : null;

  const shareVenue = useCallback(async () => {
    if (typeof window === "undefined") return;
    const url = new URL(venueMapUrl(venue.id), window.location.origin).toString();
    const title = venue.name;
    const nav = typeof navigator === "undefined" ? undefined : navigator;
    const setShareStatus = (tone: ShareFeedback["tone"], text: string) => {
      setShareFeedback({ venueId: venue.id, tone, text });
    };
    const copyToClipboard = async (successText: string, unavailableText: string) => {
      if (!nav?.clipboard?.writeText) {
        setShareStatus("error", unavailableText);
        return;
      }
      try {
        await nav.clipboard.writeText(url);
        setShareStatus("ok", successText);
      } catch {
        setShareStatus("error", "Couldn't copy the link. Copy it from your browser bar.");
      }
    };

    setShareFeedback(null);
    if (typeof nav?.share === "function") {
      try {
        await nav.share({
          title,
          url,
          text: buildVenueShareText({ name: title, cheapestPintGbp: venue.cheapestPrice }),
        });
        return;
      } catch (error) {
        if (isUserCancelledShare(error)) return;
        await copyToClipboard(
          "Share failed, but the link was copied.",
          "Share failed and clipboard is unavailable. Copy the page URL.",
        );
        return;
      }
    }
    await copyToClipboard(
      "Link copied.",
      "Sharing and clipboard are unavailable. Copy the page URL.",
    );
  }, [venue.id, venue.name, venue.cheapestPrice]);

  return { currentShareFeedback, shareVenue };
}
