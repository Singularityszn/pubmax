// One source-URL contract shared by ingestion, runtime loading and build-time
// validation. DNS checks live at the ingestion boundary because browser code
// cannot resolve hostnames, but every layer applies this same syntactic guard.

const MAX_URL_LENGTH = 2_000;

function isLiteralHostname(hostname) {
  return (
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) ||
    (hostname.startsWith("[") && hostname.endsWith("]")) ||
    hostname.includes(":")
  );
}

function isForbiddenHostname(hostname) {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  return (
    !host.includes(".") ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    isLiteralHostname(host)
  );
}

/**
 * Canonical source identity. Query strings and fragments are tracking/navigation
 * detail, while the exact normalized path remains part of attribution identity.
 */
export function canonicalizeNightOutPlaceSourceUrl(value) {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_URL_LENGTH) {
    return null;
  }
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      isForbiddenHostname(url.hostname)
    ) {
      return null;
    }
    url.search = "";
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/\.+$/, "");
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.href.replace(/\/$/, url.pathname === "/" ? "/" : "");
  } catch {
    return null;
  }
}

export function isCanonicalNightOutPlaceSourceUrl(value) {
  return (
    typeof value === "string" &&
    canonicalizeNightOutPlaceSourceUrl(value) === value
  );
}

export function nightOutPlaceSourceName(value) {
  const canonical = canonicalizeNightOutPlaceSourceUrl(value);
  if (!canonical) return null;
  return new URL(canonical).hostname.replace(/^www\./, "");
}
