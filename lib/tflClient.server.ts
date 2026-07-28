// Shared server-side client for TfL Unified API reads.
//
// Both Last Pint and nearby buses use this one guarded path so host validation,
// optional key handling, timeouts, retries, and fair-use identification cannot
// drift between transport surfaces.

const TFL_HOST = "api.tfl.gov.uk";
const TFL_BASE = `https://${TFL_HOST}`;
const DEFAULT_TIMEOUT_MS = 9000;

type TflGetOptions = {
  retries?: number;
  timeoutMs?: number;
};

function withKey(url: URL): string {
  const key = process.env.TFL_APP_KEY;
  if (!key) return url.href;
  const keyed = new URL(url.href);
  keyed.searchParams.set("app_key", key);
  return keyed.href;
}

function resolveTflUrl(path: string): URL | null {
  try {
    const url = new URL(path, TFL_BASE);
    if (url.protocol !== "https:" || url.hostname !== TFL_HOST) return null;
    if (url.port && url.port !== "443") return null;
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Fetch and parse one TfL JSON response.
 *
 * Returns null for invalid hosts, timeouts, network failures, non-success
 * responses, or invalid JSON. Callers keep ownership of what unavailable means
 * for their product surface.
 */
export async function tflGet<T>(
  path: string,
  options: TflGetOptions = {},
): Promise<T | null> {
  const { retries = 0, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const url = resolveTflUrl(path);
  if (!url) return null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(withKey(url), {
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "user-agent": "PubMaxxing/1.0 (+https://pubmaxxing.com)",
        },
      });
      if (response.ok) return (await response.json()) as T;
      if (response.status !== 429 && response.status < 500) return null;
    } catch {
      // Network and timeout failures retry only when the caller asked for it.
    } finally {
      clearTimeout(timer);
    }
  }

  return null;
}
