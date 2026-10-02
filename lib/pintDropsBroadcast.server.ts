import "server-only";

// The server's half of the Pint Drop live nudge.
//
// WHY A BROADCAST AND NOT POSTGRES CHANGES. `pint_drops` used to sit in the
// `supabase_realtime` publication, and `authenticated` could SELECT the whole
// table. A `postgres_changes` payload is the raw inserted row, so a signed-in
// browser learned an anonymous author's real handle, moderator notes, report
// reasons and receipt keys. Migration 0170 revokes that SELECT and takes the
// table out of the publication. This sender posts a payload-free signal after
// the row is already stored. The browser refetches through the filtered route.
//
// WHY THE TOPIC IS PRIVATE. A public channel authorises on the API key alone,
// and the anon key is in every browser. `private: true` makes Realtime check
// the subscriber's JWT against `realtime.messages` (the policy in 0170). This
// sender holds the secret key, which bypasses RLS. The subscriber
// (lib/realtime.ts) must set private too, or the signal lands where nobody is
// listening. A browser with no session cannot join; its poll still runs.
//
// It is fire and forget. A Pint Drop must never fail because the nudge did,
// and a caller hands the work to `deferPintDropsSignal` so a slow Realtime
// cannot add its timeout to the response.

import { after } from "next/server";

import { log } from "@/lib/log";
import { PINT_DROPS_LIVE_EVENT, PINT_DROPS_LIVE_TOPIC } from "@/lib/pintDropsTopics";
import { supabaseServerConfig } from "@/lib/supabase";

export const PINT_DROPS_BROADCAST_TIMEOUT_MS = 1_500;

export type PintDropsBroadcastDeps = Readonly<{
  fetchImpl?: typeof fetch;
  config?: { url: string; key: string } | null;
}>;

type BroadcastMessage = Readonly<{
  topic: typeof PINT_DROPS_LIVE_TOPIC;
  event: typeof PINT_DROPS_LIVE_EVENT;
  payload: Record<string, never>;
  private: true;
}>;

/**
 * Tell open map and feed surfaces that a drop landed. Resolves false when
 * nothing was sent, which is never an error for the caller. The payload is
 * empty on purpose: the signal says "refetch", never who wrote the row.
 */
export async function broadcastPintDropLanded(
  deps: PintDropsBroadcastDeps = {},
): Promise<boolean> {
  const config = deps.config === undefined ? supabaseServerConfig() : deps.config;
  if (!config) return false;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const message: BroadcastMessage = {
    topic: PINT_DROPS_LIVE_TOPIC,
    event: PINT_DROPS_LIVE_EVENT,
    payload: {},
    private: true,
  };
  const endpoint = `${config.url.replace(/\/+$/, "")}/realtime/v1/api/broadcast`;
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: config.key,
        authorization: `Bearer ${config.key}`,
      },
      body: JSON.stringify({ messages: [message] }),
      signal: AbortSignal.timeout(PINT_DROPS_BROADCAST_TIMEOUT_MS),
    });
    if (!response.ok) {
      log("warn", "pint_drops.broadcast_refused", { status: response.status });
      return false;
    }
    return true;
  } catch (error) {
    log("warn", "pint_drops.broadcast_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/** After a drop is stored. Never throws, and never waits on Realtime. */
export function signalPintDropLanded(): void {
  deferPintDropsSignal(() => broadcastPintDropLanded());
}

/**
 * Hand a nudge to the platform rather than to the response. The row is
 * already stored, so a reader must never wait on the signal. Outside a
 * request scope `after` throws, and the promise started here still runs.
 */
function deferPintDropsSignal(run: () => Promise<unknown>): void {
  const started = (async () => {
    try {
      await run();
    } catch (error) {
      log("warn", "pint_drops.signal_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();
  try {
    after(started);
  } catch {
    /* No request scope to hang it on; the promise above still runs. */
  }
}
