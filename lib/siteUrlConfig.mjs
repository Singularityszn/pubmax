export const PRODUCTION_SITE_ORIGIN = "https://pubmaxxing.com";

export function productionSiteUrlError(configuredSiteUrl) {
  if (typeof configuredSiteUrl !== "string" || configuredSiteUrl.length === 0) {
    return "NEXT_PUBLIC_SITE_URL is missing";
  }
  if (configuredSiteUrl !== configuredSiteUrl.trim()) {
    return "NEXT_PUBLIC_SITE_URL contains surrounding whitespace";
  }

  let url;
  try {
    url = new URL(configuredSiteUrl);
  } catch {
    return "NEXT_PUBLIC_SITE_URL is malformed";
  }
  if (url.protocol !== "https:") {
    return "NEXT_PUBLIC_SITE_URL must use HTTPS";
  }
  if (
    url.origin !== PRODUCTION_SITE_ORIGIN ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    return `NEXT_PUBLIC_SITE_URL must be the canonical ${PRODUCTION_SITE_ORIGIN} origin`;
  }
  return null;
}

export function assertCanonicalSiteUrlForDeployedBuild(environment = process.env) {
  if (
    environment.VERCEL_ENV !== "production" &&
    environment.VERCEL_ENV !== "preview"
  ) {
    return;
  }
  const error = productionSiteUrlError(environment.NEXT_PUBLIC_SITE_URL);
  if (error) {
    throw new Error(
      `FATAL: ${error}. Set NEXT_PUBLIC_SITE_URL=${PRODUCTION_SITE_ORIGIN} for every Vercel environment.`,
    );
  }
}
