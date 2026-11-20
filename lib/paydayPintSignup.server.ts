import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { escapeHtml } from "@/lib/escapeHtml";
import { selectEmailProvider } from "@/lib/emailProvider";
import { paydayDeliveryReady } from "@/lib/paydayPintFlags.server";
import { paydayPintStore } from "@/lib/paydayPintStore";

export const PAYDAY_CONSENT = "I am 18 or over and want a weekly payday pint email about prices near my home station.";
export const paydayTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function requestPaydayPint(email: string, station: string): Promise<boolean> {
  if (!paydayDeliveryReady()) return false;
  const token = randomBytes(32).toString("base64url");
  const unsubscribeToken = randomBytes(32).toString("base64url");
  await paydayPintStore().request({ email, station, confirmationHash: paydayTokenHash(token), unsubscribeToken, consentText: PAYDAY_CONSENT, createdAt: new Date().toISOString() });
  const url = `https://pubmaxxing.com/payday-pint/confirm?token=${encodeURIComponent(token)}`;
  const result = await selectEmailProvider().send([{ to: email, subject: "Confirm your payday pint email", html: `<p>Confirm your weekly payday pint email for ${escapeHtml(station)}.</p><p><a href="${url}">Confirm my email</a></p><p>This link expires in 48 hours. Ignore this email if you did not request it.</p>`, text: `Confirm your weekly payday pint email for ${station}: ${url}\n\nThis link expires in 48 hours. Ignore this email if you did not request it.` }]);
  return result[0]?.status === "sent";
}
