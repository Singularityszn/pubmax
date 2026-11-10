import "server-only";

import { createHash } from "crypto";

// "Ask the pub for a table": who gets the request, and whether PUBMAXX sent it.
//
// ONE PATH SENDS, AND ONLY A SEND COUNTS. When the pub has a verified operator
// (lib/venueOperatorsStore.ts) with an email address on their account, the
// request is stored `pending` for the operator panel, emailed to that operator
// through the one email seam (lib/emailProvider.ts), and stamped `emailed` once
// a message was SENT.
//
// NO ADDRESS LEAVES. The operator's address is read here and handed to the
// email seam alone; the answer names an outcome and nothing else. The person's
// contact rides as the email's Reply-To (when they chose email) so the pub
// replies to them directly, and it is never logged.

import { normalizeEmail } from "@/lib/emailAddress";
import { noopEmailProvider, selectEmailProvider, type EmailProvider } from "@/lib/emailProvider";
import { log } from "@/lib/log";
import { operatorAccountAddress } from "@/lib/operatorAccountAddress.server";
import { tableRequestOperatorEmail, type TableRequestFields } from "@/lib/tableRequests";
import { tableRequestsStore, type TableRequestsStore } from "@/lib/tableRequestsStore";
import { venueOperatorsStore } from "@/lib/venueOperatorsStore";

type TableRequestNotSentReason =
  | "no_operator"
  | "no_operator_address"
  | "email_not_sent";

export type TableRequestDeliveryOutcome =
  | { outcome: "sent" }
  | { outcome: "retryable" }
  | { outcome: "not_sent"; reason: TableRequestNotSentReason };

export type TableRequestDeliveryDeps = {
  verifiedOperatorAccountIds: (venueId: string) => Promise<string[]>;
  operatorAddress: (accountId: string) => Promise<string | null>;
  emailProvider: () => EmailProvider;
  store: () => TableRequestsStore;
};

/** At most this many operators are emailed for one request. */
const MAX_OPERATOR_RECIPIENTS = 3;
const MAX_PENDING_RETRY_AGE_MS = 23 * 60 * 60 * 1000;

const DEFAULT_DEPS: TableRequestDeliveryDeps = {
  verifiedOperatorAccountIds: (venueId) => venueOperatorsStore().verifiedOperatorAccountIds(venueId),
  operatorAddress: operatorAccountAddress,
  emailProvider: selectEmailProvider,
  store: tableRequestsStore,
};

async function operatorAddresses(
  venueId: string,
  deps: TableRequestDeliveryDeps,
): Promise<{ operators: number; addresses: string[] }> {
  const operators = (await deps.verifiedOperatorAccountIds(venueId)).slice(0, MAX_OPERATOR_RECIPIENTS);
  const addresses = (
    await Promise.all(operators.map((id) => deps.operatorAddress(id)))
  ).map(normalizeEmail).filter(Boolean);
  return { operators: operators.length, addresses: [...new Set(addresses)] };
}

async function discardQuietly(store: TableRequestsStore, id: string): Promise<void> {
  try {
    await store.discard(id);
  } catch (err) {
    log("error", "table_request.discard_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function reconcileNotSent(
  store: TableRequestsStore,
  requestId: string | undefined,
  requesterUserId: string,
  reason?: TableRequestNotSentReason,
): Promise<TableRequestDeliveryOutcome> {
  if (requestId) {
    try {
      const stored = await store.findForRequester(requestId, requesterUserId);
      if (stored?.delivery === "emailed") return { outcome: "sent" };
      if (stored) return { outcome: "retryable" };
    } catch {
      return { outcome: "retryable" };
    }
  }
  return reason ? { outcome: "not_sent", reason } : { outcome: "retryable" };
}

/** One stable UUID per account and retry key. */
function tableRequestIdForKey(requesterUserId: string, requestKey: string): string {
  const hex = createHash("sha256").update(`table-request:${requesterUserId}:${requestKey}`).digest("hex");
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function deliverTableRequest(
  fields: TableRequestFields,
  venueName: string,
  deps: TableRequestDeliveryDeps = DEFAULT_DEPS,
  now: number = Date.now(),
  requestKey: string | null = null,
): Promise<TableRequestDeliveryOutcome> {
  const keyedId = requestKey ? tableRequestIdForKey(fields.requesterUserId, requestKey) : undefined;
  let store: TableRequestsStore;
  const startedAt = Date.now();
  try {
    store = deps.store();
    if (keyedId) {
      const stored = await store.findForRequester(keyedId, fields.requesterUserId);
      if (stored?.delivery === "emailed") return { outcome: "sent" };
    }
  } catch (err) {
    log("error", "table_request.store_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { outcome: "retryable" };
  }

  const emailProvider = deps.emailProvider();
  if (emailProvider === noopEmailProvider) {
    return reconcileNotSent(store, keyedId, fields.requesterUserId, "email_not_sent");
  }

  let recipients: Awaited<ReturnType<typeof operatorAddresses>>;
  try {
    recipients = await operatorAddresses(fields.venueId, deps);
  } catch {
    return reconcileNotSent(store, keyedId, fields.requesterUserId);
  }
  const { operators, addresses } = recipients;
  if (operators === 0 || addresses.length === 0) {
    return reconcileNotSent(
      store, keyedId, fields.requesterUserId,
      operators === 0 ? "no_operator" : "no_operator_address",
    );
  }

  let requestId: string;
  try {
    // A retry carries its first key, so it lands on the same row and the same
    // email idempotency keys, and the operator is asked once.
    const stored = await store.create(fields, now, keyedId);
    requestId = stored.id;
    if (stored.delivery === "emailed") return { outcome: "sent" };
    const age = now + Math.max(0, Date.now() - startedAt) - Date.parse(stored.createdAt);
    if (!Number.isFinite(age) || age < 0 || age >= MAX_PENDING_RETRY_AGE_MS) {
      return { outcome: "retryable" };
    }
  } catch (err) {
    log("error", "table_request.store_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { outcome: "retryable" };
  }

  const message = tableRequestOperatorEmail(venueName, fields);
  const results = await emailProvider
    .send(
      addresses.map((to) => ({
        to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        ...(fields.contactKind === "email" ? { replyTo: fields.contactValue } : {}),
        idempotencyKey: `table-request:${requestId}:${createHash("sha256").update(to).digest("hex")}`,
      })),
    )
    .catch(() => []);

  if (!results.some((result) => result.status === "sent")) {
    if (keyedId) return { outcome: "retryable" };
    await discardQuietly(store, requestId);
    return { outcome: "not_sent", reason: "email_not_sent" };
  }

  try {
    await store.markEmailed(requestId, now);
  } catch (err) {
    // The email went, so the person is told it went. The panel may miss this
    // one row until the stamp is retried by hand; the log says which.
    log("error", "table_request.stamp_failed", {
      requestId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return { outcome: "sent" };
}
