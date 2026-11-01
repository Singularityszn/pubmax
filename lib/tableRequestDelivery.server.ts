import "server-only";

// "Ask the pub for a table": who gets the request, and whether PUBMAXX sent it.
//
// ONE PATH SENDS, AND ONLY A SEND COUNTS. When the pub has a verified operator
// (lib/venueOperatorsStore.ts) with an email address on their account, the
// request is stored `pending` for the operator panel, emailed to that operator
// through the one email seam (lib/emailProvider.ts), and stamped `emailed` once
// a message was SENT. Every other answer is `not_sent`: no verified operator,
// no address on file, a keyless deployment (the seam answers `skipped`), a
// send that failed, or a store that could not keep the request. A request that
// was stored and then not sent is discarded, so an operator never lists a
// request the person was told PUBMAXX did not send.
//
// NO ADDRESS LEAVES. The operator's address is read here and handed to the
// email seam alone; the answer names an outcome and nothing else. The person's
// contact rides as the email's Reply-To (when they chose email) so the pub
// replies to them directly, and it is never logged.

import { selectEmailProvider, type EmailProvider } from "@/lib/emailProvider";
import { log } from "@/lib/log";
import { operatorAccountAddress } from "@/lib/operatorAccountAddress.server";
import { tableRequestOperatorEmail, type TableRequestFields } from "@/lib/tableRequests";
import { tableRequestsStore, type TableRequestsStore } from "@/lib/tableRequestsStore";
import { venueOperatorsStore } from "@/lib/venueOperatorsStore";

export type TableRequestNotSentReason =
  | "no_operator"
  | "no_operator_address"
  | "store_unavailable"
  | "email_not_sent";

export type TableRequestDeliveryOutcome =
  | { outcome: "sent" }
  | { outcome: "not_sent"; reason: TableRequestNotSentReason };

export type TableRequestDeliveryDeps = {
  verifiedOperatorAccountIds: (venueId: string) => Promise<string[]>;
  operatorAddress: (accountId: string) => Promise<string | null>;
  emailProvider: () => EmailProvider;
  store: () => TableRequestsStore;
};

/** At most this many operators are emailed for one request. */
const MAX_OPERATOR_RECIPIENTS = 3;

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
  let operators: string[] = [];
  try {
    operators = (await deps.verifiedOperatorAccountIds(venueId)).slice(0, MAX_OPERATOR_RECIPIENTS);
  } catch {
    operators = [];
  }
  const addresses = (
    await Promise.all(operators.map((id) => deps.operatorAddress(id).catch(() => null)))
  ).filter((address): address is string => Boolean(address));
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

/**
 * Deliver one validated request to the pub's verified operator, or report that
 * PUBMAXX did not send it. Never throws.
 */
export async function deliverTableRequest(
  fields: TableRequestFields,
  venueName: string,
  deps: TableRequestDeliveryDeps = DEFAULT_DEPS,
  now: number = Date.now(),
): Promise<TableRequestDeliveryOutcome> {
  const { operators, addresses } = await operatorAddresses(fields.venueId, deps);
  if (operators === 0) return { outcome: "not_sent", reason: "no_operator" };
  if (addresses.length === 0) return { outcome: "not_sent", reason: "no_operator_address" };

  const store = deps.store();
  let requestId: string;
  try {
    requestId = (await store.create(fields, now)).id;
  } catch (err) {
    log("error", "table_request.store_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { outcome: "not_sent", reason: "store_unavailable" };
  }

  const message = tableRequestOperatorEmail(venueName, fields);
  const results = await deps
    .emailProvider()
    .send(
      addresses.map((to, index) => ({
        to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        ...(fields.contactKind === "email" ? { replyTo: fields.contactValue } : {}),
        idempotencyKey: `table-request:${requestId}:${index}`,
      })),
    )
    .catch(() => []);

  if (!results.some((result) => result.status === "sent")) {
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
