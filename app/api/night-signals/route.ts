// GET /api/night-signals — the reviewed Night Signal feed.
//
// It has TWO sources and they say the same thing: a claim a person approved.
// The committed snapshot is the CLI's reviewed output, and the durable rows are
// the ones a moderator advanced at POST /api/admin/night-signals. Both are read
// through the same admission rules, so nothing reaches a reader that has not
// been approved, dated and left in window.
//
// A durable read we could NOT run is reported as `durable: "unavailable"` and
// the bundled snapshot still answers, because a feed that goes quiet on a store
// error tells a reader the city has nothing on.

import snapshot from "@/public/data/night_signals/latest.json";
import { jsonNoStore } from "@/lib/apiResponses";
import { activeNightSignalClaims, type NightSignalClaim } from "@/lib/nightSignalClaims";
import { nightSignalCandidateStore } from "@/lib/nightSignalStore.server";
import { fireAndForgetPush, maybeBroadcastNightSignalLive } from "@/lib/pushSender";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const entityId = url.searchParams.get("entityId")?.trim() ?? "";
  const active = activeNightSignalClaims(snapshot);
  // "Signal went live" moment: the night-signal snapshot is a static import
  // that only changes on deploy, so the first request after a new snapshot is
  // its go-live edge. Fire-and-forget a broadcast to ALL registered devices,
  // deduped durably per snapshot version (lib/pushSender.ts) so later reads
  // are no-ops. The durable rows below are deliberately NOT part of that
  // dedupe: their go-live is a moderator's decision, not a deploy.
  fireAndForgetPush(() => maybeBroadcastNightSignalLive(
    snapshot.generatedAt,
    active.map((claim) => ({
      id: claim.id,
      title: claim.entity.id,
      body: claim.claim,
      entityId: claim.entity.id,
    })),
  ));

  const reviewed = await nightSignalCandidateStore().approved(Date.now());
  const merged = new Map<string, NightSignalClaim>(active.map((claim) => [claim.id, claim]));
  if (reviewed.status === "ready") {
    for (const claim of reviewed.candidates) merged.set(claim.id, claim);
  }

  const claims = [...merged.values()].filter((claim) => !entityId || claim.entity.id === entityId);
  const body = {
    version: 1,
    asOf: snapshot.generatedAt,
    durable: reviewed.status === "ready" ? ("ready" as const) : ("unavailable" as const),
    claims,
  };
  // The merged answer can change when a moderator approves a stored row or
  // when an approved row expires. That is true of durable and memory stores.
  return jsonNoStore(body);
}
