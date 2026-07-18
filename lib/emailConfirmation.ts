// Double-opt-in confirmation seam — builds the confirmation email and dispatches
// it, INERT until an email provider is configured. This is the "flow is built,
// inert until keys" half of the Cycle-2 early-email-capture decision: a capture
// stores an UNCONFIRMED subscriber (lib/emailSubscribersStore.ts), then this
// module would send a one-link "confirm your weekly pint digest" email. No row
// is ever auto-confirmed; the address becomes mailable only after the recipient
// follows the confirm link.
//
// ── PROVIDER GATING (noop today) ─────────────────────────────────────────────
// Delivery flips on with the SAME env keys the digest sender uses
// (RESEND_API_KEY + EMAIL_FROM — see lib/emailProvider.ts on feat/email-digest).
// Until BOTH exist, dispatchConfirmationEmail() is a truthful noop: it returns
// { sent: false, reason: "email_provider_not_configured" } and the route reports
// confirmationSent:false so the UI never claims an email that did not go out.
//
// When feat/email-digest merges, wire the ONE marked line below to
// selectEmailProvider().send([buildConfirmationEmail(...)]) — the message shape
// here already matches EmailMessage ({ to, subject, html, text }). No other
// caller changes.

/** The env keys real delivery needs — an API key with no verified From address
 *  cannot send. Mirrors isResendConfigured() on the digest branch. */
export function isConfirmationDeliveryConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

/** Build the per-recipient confirm URL. The token is a capability secret, so it
 *  travels in the link instead of the email address. */
export function confirmUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/api/email-subscribers/confirm?token=${encodeURIComponent(token)}`;
}

/** Build the per-recipient unsubscribe URL (same token, different verb). */
export function unsubscribeUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/api/email-subscribers/unsubscribe?token=${encodeURIComponent(token)}`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type ConfirmationEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

/**
 * Render the confirmation email. Email-safe (inline styles only, no external
 * CSS/fonts/images) and single-purpose — it states exactly what confirming signs
 * you up for (the weekly pint digest) and carries an unsubscribe link, honouring
 * purpose limitation. Shape matches EmailMessage on the digest branch.
 */
export function buildConfirmationEmail(params: {
  email: string;
  origin: string;
  token: string;
}): ConfirmationEmail {
  const confirm = confirmUrl(params.origin, params.token);
  const unsub = unsubscribeUrl(params.origin, params.token);
  const subject = "Confirm your weekly pint digest";
  const html = [
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#17171a;max-width:480px;margin:0 auto;padding:24px">`,
    `<h1 style="font-size:20px;margin:0 0 12px">One tap to confirm</h1>`,
    `<p style="font-size:15px;line-height:1.5;color:#3f3f46;margin:0 0 16px">You asked to get the weekly pint digest from PUBMAXX. Confirm below and that is the only thing we will email you.</p>`,
    `<p style="margin:0 0 20px"><a href="${esc(confirm)}" style="display:inline-block;background:#f0a01a;color:#17171a;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">Confirm subscription</a></p>`,
    `<p style="font-size:13px;color:#6b6b73;margin:0 0 8px">Didn't ask for this? Ignore this email — you will not be added.</p>`,
    `<p style="font-size:12px;color:#6b6b73;margin:0"><a href="${esc(unsub)}" style="color:#6b6b73">Unsubscribe</a></p>`,
    `</div>`,
  ].join("");
  const text = [
    "One tap to confirm",
    "",
    "You asked to get the weekly pint digest from PUBMAXX. Confirm with the link below and that is the only thing we will email you.",
    "",
    `Confirm: ${confirm}`,
    "",
    "Didn't ask for this? Ignore this email — you will not be added.",
    `Unsubscribe: ${unsub}`,
  ].join("\n");
  return { to: params.email, subject, html, text };
}

export type ConfirmationDispatchResult = {
  /** True only when an email actually left. False today (provider-gated noop). */
  sent: boolean;
  /** Why it did not send — never a secret. */
  reason?: string;
};

/**
 * Dispatch the confirmation email. INERT today: even with keys present the
 * transport is the pending drop-in (matching resendEmailProvider on the digest
 * branch), so this never delivers and never throws — it returns a truthful
 * "not sent" the route surfaces as confirmationSent:false.
 */
export async function dispatchConfirmationEmail(params: {
  email: string;
  origin: string;
  token: string;
}): Promise<ConfirmationDispatchResult> {
  // Render the message now so a malformed input would surface even while the
  // transport is inert, and so the built message is the exact payload the real
  // sender will hand to the provider (no shape drift between now and go-live).
  const message = buildConfirmationEmail(params);
  if (!isConfirmationDeliveryConfigured()) {
    return { sent: false, reason: "email_provider_not_configured" };
  }
  // ── WIRE HERE when feat/email-digest merges ────────────────────────────────
  // const [result] = await selectEmailProvider().send([message]);
  // return { sent: result.status === "sent", reason: result.reason };
  // Until the shared transport lands, delivery is a documented noop.
  void message;
  return { sent: false, reason: "email_transport_not_implemented" };
}
