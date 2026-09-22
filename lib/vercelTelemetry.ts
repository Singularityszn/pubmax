const PUBLIC_STATIC_PATHS = new Set([
  "/",
  "/about",
  "/borough",
  "/crawls",
  "/historic",
  "/map",
  "/near",
  "/places",
  "/pint-index",
  "/privacy",
  "/pubs",
  "/terms",
  "/today",
  "/tonight",
]);

export type SafeVercelTelemetryLocation = {
  route: string;
  url: string;
};

/** Keep Vercel telemetry on public static pages and remove query or fragment data. */
export function safeVercelTelemetryLocation(
  eventUrl: unknown,
  currentOrigin: unknown,
): SafeVercelTelemetryLocation | null {
  if (
    typeof eventUrl !== "string"
    || eventUrl.length > 2_048
    || typeof currentOrigin !== "string"
    || currentOrigin.length > 2_048
  ) return null;

  try {
    const originUrl = new URL(currentOrigin);
    if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:") return null;
    const origin = originUrl.origin;
    const url = new URL(eventUrl, origin);
    if (url.origin !== origin || !PUBLIC_STATIC_PATHS.has(url.pathname)) return null;
    return {
      route: url.pathname,
      url: `${origin}${url.pathname}`,
    };
  } catch {
    return null;
  }
}

export function shouldMountVercelTelemetry(
  environment: string | undefined,
  vercelDeployment?: string,
): boolean {
  return environment === "production" && vercelDeployment === "1";
}
