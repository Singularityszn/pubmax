import "server-only";
import { paydayPintEmail, selectPaydayPints, type PaydayStation, type PaydayVenue } from "@/lib/paydayPint";
import { selectEmailProvider, type EmailProvider } from "@/lib/emailProvider";
import { paydayStations, paydayVenues } from "@/lib/paydayPintData.server";
import { paydayDeliveryReady } from "@/lib/paydayPintFlags.server";
import { paydayPintStore, type PaydayStore } from "@/lib/paydayPintStore";

type JobDependencies = { enabled: boolean; store: PaydayStore; provider: EmailProvider; stations: PaydayStation[]; venues: PaydayVenue[]; postalAddress: string; now: Date };
export async function runPaydayPintJob(deps: JobDependencies): Promise<{ status: "disabled" | "not_due" | "completed"; sent: number; skipped: number }> {
  if (!deps.enabled) return { status: "disabled", sent: 0, skipped: 0 };
  const friday = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "Europe/London" }).format(deps.now);
  if (friday !== "Fri") return { status: "not_due", sent: 0, skipped: 0 };
  const week = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/London" }).format(deps.now);
  let sent = 0, skipped = 0;
  for (const subscriber of await deps.store.active()) {
    const station = deps.stations.find((item) => item.name === subscriber.station);
    if (!station) { skipped++; continue; }
    const pints = selectPaydayPints(station, deps.venues, deps.now.getTime());
    if (!await deps.store.claim(subscriber.id, week)) { skipped++; continue; }
    const unsubscribeUrl = `https://pubmaxxing.com/api/payday-pint/unsubscribe?token=${encodeURIComponent(subscriber.unsubscribeToken)}`;
    const message = paydayPintEmail(station, pints, { to: subscriber.email, unsubscribeUrl, postalAddress: deps.postalAddress });
    if (!await deps.store.isActive(subscriber.id, subscriber.unsubscribeToken, subscriber.consentAt)) { skipped++; continue; }
    const outcome = await deps.provider.send([{ ...message, idempotencyKey: `payday-${subscriber.id}-${week}` }]);
    if (outcome[0]?.status === "sent") sent++; else skipped++;
  }
  return { status: "completed", sent, skipped };
}
export async function dispatchPaydayPint(): Promise<{ status: "disabled" | "not_due" | "completed"; sent: number; skipped: number }> {
  if (!paydayDeliveryReady()) return { status: "disabled", sent: 0, skipped: 0 };
  return runPaydayPintJob({ enabled: true, store: paydayPintStore(), provider: selectEmailProvider(), stations: await paydayStations(), venues: await paydayVenues(), postalAddress: process.env.PAYDAY_PINT_POSTAL_ADDRESS ?? "", now: new Date() });
}
