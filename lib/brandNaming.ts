/**
 * PUBMAXX is the product's one name on every web surface (product decision
 * 16 Oct 2026, superseding the captain's 2026-08-17 brand/app split): the
 * wordmark, page titles, share-card titles and alt text, `siteName`, the web
 * manifest and every line of copy. The domain `pubmaxxing.com` and its email
 * addresses are addresses, not names, and stay as they are.
 *
 * `APP_NAME` survives for ONE case: the native shells' install name and the
 * store listing name (`capacitor.config.ts`, the iOS and Android string
 * tables, lib/storeListing.ts). Renaming an installed app or a store record is
 * a release step the captain takes, not a copy edit, so those keep the old
 * name until he does. No web surface may print it.
 */
export const BRAND_NAME = "PUBMAXX";
export const APP_NAME = "PUBMAXXING";

/** Page title suffix for in-app surfaces (`About · PUBMAXX`). */
export function appPageTitle(pageTitle: string): string {
  return `${pageTitle} · ${BRAND_NAME}`;
}

/** Open Graph / Twitter `siteName` — always the brand. */
export function metadataSiteName(): string {
  return BRAND_NAME;
}
