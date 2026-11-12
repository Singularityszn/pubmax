// The click half of "Share this pint", "Share your receipt" and "Share your
// Been card", loaded only when the reader taps one (components/share/
// SharePintButton.tsx, components/pintdrop/ReceiptShareStep.tsx and
// components/profile/BeenCardShare.tsx import this lazily), so the surfaces
// that offer the action carry a button and nothing else until then.
//
// The OS sheet first (the native shell seam, then the Web Share API), and the
// clipboard after it. A DELIBERATE EXCEPTION to lib/shareSheet.ts's wa.me
// fallback: this is a quiet action on a price, and on a desktop with no share
// sheet the honest fallback is the link in the clipboard, not a WhatsApp tab
// the reader did not ask for (product owner, Oct 2026 UX audit, P2-C).

import type { Route } from "next";

import { trackEvent } from "@/lib/analytics";
import type { ContentShareSurface } from "@/lib/analyticsEvents";
import { shareViaNativeSheet } from "@/lib/nativeShare";
import { beenCardShareText, beenCardTitle } from "@/lib/beenCard";
import { buildPintShareText, pintShareUrl, type PintShare } from "@/lib/pintShare";
import { buildPersonalReceiptShareText, type ReceiptShare } from "@/lib/pintReceipt";
import { isUserCancelledShare } from "@/lib/venueShare";

export type PintShareOutcome = "shared" | "cancelled" | "copied" | "failed";

export type PintShareActionDeps = {
  origin?: string;
  nav?: {
    share?: (data: { title: string; text: string; url: string }) => Promise<void>;
    clipboard?: { writeText?: (text: string) => Promise<void> };
  };
  shareNatively?: typeof shareViaNativeSheet;
  track?: typeof trackEvent;
};

type ShareRequest = { path: Route; title: string; text: string; surface: ContentShareSurface };

async function shareLinkOrCopy(
  request: ShareRequest,
  deps: PintShareActionDeps,
): Promise<PintShareOutcome> {
  const origin = deps.origin ?? (typeof window === "undefined" ? "" : window.location.origin);
  const nav = deps.nav ?? (typeof navigator === "undefined" ? undefined : navigator);
  const track = deps.track ?? trackEvent;
  const url = new URL(request.path, origin || "https://pubmaxxing.com").toString();
  const input = { title: request.title, text: request.text, url };
  const surface = request.surface;

  const native = await (deps.shareNatively ?? shareViaNativeSheet)(input);
  if (native === "shared") {
    track("content_shared", { channel: "native", surface });
    return "shared";
  }
  if (native === "cancelled") return "cancelled";

  if (typeof nav?.share === "function") {
    try {
      await nav.share(input);
      track("content_shared", { channel: "native", surface });
      return "shared";
    } catch (error) {
      if (isUserCancelledShare(error)) return "cancelled";
      // A real failure falls through to the clipboard.
    }
  }

  const writeText = nav?.clipboard?.writeText;
  if (typeof writeText !== "function") return "failed";
  try {
    // The words travel with the link, so a pasted price still names its source.
    await writeText.call(nav?.clipboard, `${input.text} ${url}`);
    track("content_shared", { channel: "copy", surface });
    return "copied";
  } catch {
    return "failed";
  }
}

export function sharePint(
  share: PintShare,
  deps: PintShareActionDeps = {},
): Promise<PintShareOutcome> {
  return shareLinkOrCopy(
    {
      path: pintShareUrl(share.venueId),
      title: share.name,
      text: buildPintShareText(share),
      surface: "pint",
    },
    deps,
  );
}

export function shareReceipt(
  share: ReceiptShare,
  deps: PintShareActionDeps = {},
): Promise<PintShareOutcome> {
  return shareLinkOrCopy(
    {
      path: share.path,
      title: `My receipt from ${share.receipt.venueName}`,
      text: buildPersonalReceiptShareText(share.receipt),
      surface: "receipt",
    },
    deps,
  );
}

/** The owner's Been card: the signed path the server minted, never a count the page holds. */
export function shareBeenCard(
  card: { path: string; handle: string; pubs: number },
  deps: PintShareActionDeps = {},
): Promise<PintShareOutcome> {
  return shareLinkOrCopy(
    {
      path: card.path as Route,
      title: beenCardTitle(card.handle, card.pubs),
      text: beenCardShareText(card.pubs),
      surface: "been",
    },
    deps,
  );
}
