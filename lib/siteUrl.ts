const PRODUCTION_SITE_ORIGIN = "https://pubmaxxing.com";

function httpOrigin(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Production callbacks always return through the canonical public site.
 * Local and test environments stay on their current origin.
 */
export function siteOrigin(
  currentUrl: string,
  environment: string | undefined = process.env.NODE_ENV,
  configuredSiteUrl: string | undefined = process.env.NEXT_PUBLIC_SITE_URL,
): string | null {
  const currentOrigin = httpOrigin(currentUrl);
  if (!currentOrigin) return null;
  if (environment !== "production") return currentOrigin;
  const configuredOrigin = httpOrigin(
    configuredSiteUrl ?? PRODUCTION_SITE_ORIGIN,
  );
  return configuredOrigin === PRODUCTION_SITE_ORIGIN ? configuredOrigin : null;
}
