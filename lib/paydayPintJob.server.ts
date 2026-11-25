import "server-only";
import { randomUUID } from "node:crypto";
import { paydayPintEmail, selectPaydayPints, type PaydayStation, type PaydayVenue } from "@/lib/paydayPint";
import { selectEmailProvider, type EmailProvider } from "@/lib/emailProvider";
import { paydayStations, paydayVenues } from "@/lib/paydayPintData.server";
import { paydayDeliveryReady } from "@/lib/paydayPintFlags.server";
import { paydayPintStore, type PaydayStore } from "@/lib/paydayPintStore";

type JobDependencies = { enabled: boolean; store: PaydayStore; provider: EmailProvider; stations: PaydayStation[]; venues: PaydayVenue[]; postalAddress: string; now: Date };
type JobResult = { status: "disabled" | "not_due" | "completed"; sent: number; skipped: number; retryable: number; failed: number };
export async function runPaydayPintJob(deps: JobDependencies): Promise<JobResult> {
  if (!deps.enabled) return { status: "disabled", sent: 0, skipped: 0, retryable: 0, failed: 0 };
  const friday = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "Europe/London" }).format(deps.now);
  if (friday !== "Fri") return { status: "not_due", sent: 0, skipped: 0, retryable: 0, failed: 0 };
  const week = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/London" }).format(deps.now);
  let sent = 0, skipped = 0, retryable = 0, failed = 0;
  for (const subscriber of await deps.store.active()) {
    try {
      const station = deps.stations.find((item) => item.name === subscriber.station);
      const claim = randomUUID();
      if (!await deps.store.claim(subscriber.id, week, claim, deps.now.toISOString())) { skipped++; continue; }
      const unsubscribeUrl = `https://pubmaxxing.com/api/payday-pint/unsubscribe?token=${encodeURIComponent(subscriber.unsubscribeToken)}`;
      const candidate = station ? {
        ...paydayPintEmail(station, selectPaydayPints(station, deps.venues, deps.now.getTime()), { to: subscriber.email, unsubscribeUrl, postalAddress: deps.postalAddress }),
        from: process.env.EMAIL_FROM?.trim() ?? "",
        idempotencyKey: `payday-${subscriber.id}-${week}`,
      } : null;
      const message = await deps.store.prepareDelivery(subscriber.id, week, claim, candidate);
      if (!message || !await deps.store.isActive(subscriber.id, subscriber.unsubscribeToken, subscriber.consentAt)) {
        await deps.store.finish(subscriber.id, week, claim, "terminal");
        skipped++;
        continue;
      }
      let outcome: Awaited<ReturnType<EmailProvider["send"]>>[number] | undefined;
      try { outcome = (await deps.provider.send([message]))[0]; } catch { /* retry below */ }
      const state = outcome?.status === "sent" ? "delivered" : outcome?.status === "invalid" ? "terminal" : "retryable";
      const settled = await deps.store.finish(subscriber.id, week, claim, state);
      if (settled === "delivered") sent++; else if (settled === "retryable") retryable++; else if (state === "retryable") failed++; else skipped++;
    } catch {
      failed++;
    }
  }
  return { status: "completed", sent, skipped, retryable, failed };
}
export async function dispatchPaydayPint(): Promise<JobResult> {
  if (!paydayDeliveryReady()) return { status: "disabled", sent: 0, skipped: 0, retryable: 0, failed: 0 };
  return runPaydayPintJob({ enabled: true, store: paydayPintStore(), provider: selectEmailProvider(), stations: await paydayStations(), venues: await paydayVenues(), postalAddress: process.env.PAYDAY_PINT_POSTAL_ADDRESS ?? "", now: new Date() });
}
