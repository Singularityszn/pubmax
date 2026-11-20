import { publicApiError } from "@/lib/apiError";
import { readBadge } from "@/lib/embedBadge.server";

const escapeXml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);

export async function GET(_request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  try {
    const badge = await readBadge(kind, id);
    if (!badge) return publicApiError("Badge not found.", "NOT_FOUND", 404, { headers: { "Cache-Control": "no-store" } });
    const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${badge.observedOn}T00:00:00Z`));
    const image = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="160" viewBox="0 0 360 160" role="img" aria-label="${escapeXml(`${badge.title}: £${badge.priceGbp.toFixed(2)} at ${badge.pubName}. ${badge.publisher}, ${date}.`)}"><rect width="360" height="160" rx="16" fill="#17171b"/><text x="20" y="27" fill="#fff" font-family="Arial,sans-serif" font-size="13" font-weight="bold">PUBMAXX</text><text x="20" y="53" fill="#fff" font-family="Arial,sans-serif" font-size="14" ${badge.title.length > 39 ? 'textLength="320" lengthAdjust="spacingAndGlyphs"' : ""}>${escapeXml(badge.title)}</text><text x="20" y="94" fill="#ff5964" font-family="Arial,sans-serif" font-size="35" font-weight="bold">£${badge.priceGbp.toFixed(2)}</text><text x="20" y="120" fill="#fff" font-family="Arial,sans-serif" font-size="15" ${badge.pubName.length > 38 ? 'textLength="320" lengthAdjust="spacingAndGlyphs"' : ""}>${escapeXml(badge.pubName)}</text><text x="20" y="143" fill="#d5d5da" font-family="Arial,sans-serif" font-size="12" ${badge.publisher.length > 31 ? 'textLength="320" lengthAdjust="spacingAndGlyphs"' : ""}>${escapeXml(`${badge.publisher} · ${date}`)}</text></svg>`;
    return new Response(image, { headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" } });
  } catch {
    return publicApiError("Badge is unavailable.", "BADGE_UNAVAILABLE", 503, { headers: { "Cache-Control": "no-store" }, retryable: true });
  }
}
