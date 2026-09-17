// Download your own PUBMAXX data.
//
// UK GDPR's portable copy, as a self-serve door beside account deletion. The
// document is `lib/accountExport.ts`; the reads are `lib/accountExport.server.ts`.
//
// THE TARGET IS THE TOKEN, never a request field, exactly as `DELETE
// /api/account` has it: the account exported is the one the caller's own
// verified bearer names, so a request can only ever export the account that
// sent it. The `resolveMessageHandle` / `gateHandleAction` seam runs on top of
// that as the ordinary ownership check every private read of this kind goes
// through; a caller with no claimed handle keeps the door, because a handle is
// not what makes an account theirs, and their Memories are still theirs.
//
// A lane that could not be read refuses the WHOLE export as a retryable 503
// naming the lane, because a partial file handed over as a complete one is a
// false record of what is held.

import {
  accountExportFilename,
  unavailableExportLanes,
} from "@/lib/accountExport";
import { buildAccountExport } from "@/lib/accountExport.server";
import { publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { resolveMessageHandle } from "@/lib/messageAuth";
import { isLimited } from "@/lib/pintDrops";
import { gateHandleAction } from "@/lib/profileOwnership";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";

assertServerEnv();

/** An export is a heavy read; five in a window is a person, more is a script. */
const EXPORT_LIMIT = 5;

export async function GET(request: Request): Promise<Response> {
  const caller = await callerUserId(request);
  if (!caller) {
    return publicApiError("Sign in to download your data.", "UNAUTHENTICATED", 401);
  }

  const key = `account-export:${caller}:${hashIp(clientIp(request))}`;
  if (await isLimited(caller, key, EXPORT_LIMIT)) {
    return publicApiError(
      "Too many export requests, slow down.",
      "RATE_LIMITED",
      429,
      { retryable: true },
    );
  }

  const handle = await resolveMessageHandle(request, null, caller);
  if (handle) {
    const ownership = await gateHandleAction(request, handle, caller);
    if (!ownership.allowed) {
      return publicApiErrorFromStatus(ownership.error, ownership.status);
    }
  }

  const document = await buildAccountExport(caller);
  const unavailable = unavailableExportLanes(document);
  if (unavailable.length > 0) {
    return publicApiError(
      "Your data could not be prepared.",
      "STORE_UNAVAILABLE",
      503,
      { retryable: true, details: { lanes: unavailable } },
    );
  }

  return jsonNoStore(document, {
    status: 200,
    headers: {
      "content-disposition": `attachment; filename="${accountExportFilename(document.account.handle, document.exportedAt)}"`,
    },
  });
}
