// The click half of "Share this pint", loaded only when the reader taps it
// (components/share/SharePintButton.tsx imports this lazily), so the surfaces
// that offer the action carry a button and nothing else until then.
//
// The OS sheet first (the native shell seam, then the Web Share API), and the
// clipboard after it. A DELIBERATE EXCEPTION to lib/shareSheet.ts's wa.me
// fallback: this is a quiet action on a price, and on a desktop with no share
// sheet the honest fallback is the link in the clipboard, not a WhatsApp tab
// the reader did not ask for (product owner, Oct 2026 UX audit, P2-C).

import { trackEvent } from "@/lib/analytics";
import { shareViaNativeSheet } from "@/lib/nativeShare";
import { buildPintShareText, pintShareUrl, type PintShare } from "@/lib/pintShare";
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

export async function sharePint(
  share: PintShare,
  deps: PintShareActionDeps = {},
): Promise<PintShareOutcome> {
  const origin = deps.origin ?? (typeof window === "undefined" ? "" : window.location.origin);
  const nav = deps.nav ?? (typeof navigator === "undefined" ? undefined : navigator);
  const track = deps.track ?? trackEvent;
  const url = new URL(pintShareUrl(share.venueId), origin || "https://pubmaxxing.com").toString();
  const input = { title: share.name, text: buildPintShareText(share), url };

  const native = await (deps.shareNatively ?? shareViaNativeSheet)(input);
  if (native === "shared") {
    track("content_shared", { channel: "native", surface: "pint" });
    return "shared";
  }
  if (native === "cancelled") return "cancelled";

  if (typeof nav?.share === "function") {
    try {
      await nav.share(input);
      track("content_shared", { channel: "native", surface: "pint" });
      return "shared";
    } catch (error) {
      if (isUserCancelledShare(error)) return "cancelled";
      // A real failure falls through to the clipboard.
    }
  }

  const writeText = nav?.clipboard?.writeText;
  if (typeof writeText !== "function") return "failed";
  try {
    // The words travel with the link, so a pasted pint still names its source.
    await writeText.call(nav?.clipboard, `${input.text} ${url}`);
    track("content_shared", { channel: "copy", surface: "pint" });
    return "copied";
  } catch {
    return "failed";
  }
}
