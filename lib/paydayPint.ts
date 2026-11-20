import { escapeHtml } from "@/lib/escapeHtml";
import { formatGbp } from "@/lib/formatGbp";
import { haversineKm } from "@/lib/haversine";

export type PaydayStation = { name: string; lat: number; lng: number };
export type PaydayVenue = { id: string; name: string; lat: number; lng: number; fairPint?: readonly unknown[] };
export type PaydayPint = { id: string; name: string; pricePence: number; sourceUrl: string; observedAt: string };

export function selectPaydayPints(station: PaydayStation, venues: readonly PaydayVenue[]): PaydayPint[] {
  return venues.flatMap((venue) => {
    const [pricePence, sourceUrl, observedAt] = venue.fairPint ?? [];
    if (typeof venue.id !== "string" || !venue.id || typeof venue.name !== "string" || !venue.name.trim()
      || !Number.isFinite(venue.lat) || !Number.isFinite(venue.lng)
      || haversineKm([station.lng, station.lat], [venue.lng, venue.lat]) > 1
      || typeof pricePence !== "number" || !Number.isInteger(pricePence) || pricePence <= 0
      || typeof sourceUrl !== "string" || typeof observedAt !== "string" || !Number.isFinite(Date.parse(observedAt))) return [];
    let url: URL;
    try { url = new URL(sourceUrl); } catch { return []; }
    if (url.protocol !== "https:" && url.protocol !== "http:") return [];
    return [{ id: venue.id, name: venue.name, pricePence, sourceUrl, observedAt }];
  }).sort((a, b) => a.pricePence - b.pricePence || a.name.localeCompare(b.name)).slice(0, 3);
}

export function renderPaydayPint(station: PaydayStation, pints: readonly PaydayPint[]): string {
  const items = pints.map((pint) => `<li><strong>${escapeHtml(pint.name)}</strong> - ${formatGbp(pint.pricePence / 100)}<br>Source: <a href="${escapeHtml(pint.sourceUrl)}">${escapeHtml(new URL(pint.sourceUrl).hostname)}</a>, read ${escapeHtml(pint.observedAt.slice(0, 10))}</li>`).join("");
  const content = items ? `<ul>${items}</ul><p>Prices may have changed. Distances are straight-line estimates.</p>` : "<p>We could not find a sourced pint price within 1 km of this station.</p>";
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;background:#f8f4ef;color:#1c1b20"><h1>Payday pint</h1><p>Listed pint prices within 1 km of ${escapeHtml(station.name)} station.</p>${content}<p>This is a preview. No email has been sent.</p></div>`;
}

export function paydayPintEmail(station: PaydayStation, pints: readonly PaydayPint[], options: { to: string; unsubscribeUrl: string; postalAddress: string }) {
  const url = new URL(options.unsubscribeUrl);
  if (url.protocol !== "https:" || !options.postalAddress.trim()) throw new Error("A secure unsubscribe URL and postal address are required.");
  const html = renderPaydayPint(station, pints).replace("<p>This is a preview. No email has been sent.</p>", `<p>You asked for the weekly payday pint email. <a href="${escapeHtml(url.toString())}">Unsubscribe</a>.</p><p>${escapeHtml(options.postalAddress)}</p>`);
  const lines = pints.map((pint) => `${pint.name}: ${formatGbp(pint.pricePence / 100)}. Source read ${pint.observedAt.slice(0, 10)}: ${pint.sourceUrl}`);
  return {
    to: options.to,
    subject: `Payday pint near ${station.name}`,
    html,
    text: [`Listed pint prices within 1 km of ${station.name} station.`, ...(lines.length ? lines : ["We could not find a sourced pint price within 1 km of this station."]), "Prices may have changed. Distances are straight-line estimates.", `Unsubscribe: ${url}`, options.postalAddress].join("\n\n"),
    headers: { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}
