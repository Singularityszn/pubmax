import type { CityId } from "@/lib/cities";
import { useEffect, useReducer, useRef, useState } from "react";
import { transitionFairPintSave, type FairPintDrawn, type FairPintSaveState } from "@/lib/fairPint";
import { DEFAULT_PLAN_COMPOSER_TITLE } from "@/lib/plan";
import { isPlanId } from "@/lib/planId";
import { isNativeApp } from "@/lib/nativePlatform";
import { readApiJson } from "@/lib/apiErrorMessage";
import { refreshPlanInviteToken, writePlanInviteToken } from "@/lib/planInviteTokenClient";
import { planInviteShareUrl } from "@/lib/planCrewInviteUrl";
import { writePlanCapability } from "@/lib/planSessionCapability";
import { dismissMapFirstVisitArrival } from "@/lib/mapFirstVisitArrival";
import { shareNightObject } from "@/lib/shareSheet";
export function useFairPintSave(last: FairPintDrawn) {
  const scope = last.generated.operationKey;
  const [stored, dispatch] = useReducer(transitionFairPintSave, { phase: "editing", scope, notice: "" });
  const state: FairPintSaveState = stored.scope === scope ? stored : { phase: "editing", scope, notice: "" };
  const pending = useRef<AbortController | null>(null);
  const [canShare] = useState(() => isNativeApp() || (typeof navigator !== "undefined" && typeof navigator.share === "function"));
  useEffect(() => () => { pending.current?.abort(); pending.current = null; }, [scope]);
  async function prepareLink(planId: string, token?: unknown) {
    const readable = typeof token === "string" && token ? token : await refreshPlanInviteToken(planId);
    if (typeof readable === "string") writePlanInviteToken(planId, readable);
    const url = planInviteShareUrl(readable, window.location.href);
    dispatch({ type: "link", scope, url });
  }
  async function save(name: string, cityId: CityId) {
    if (pending.current || state.phase !== "editing") return;
    const controller = new AbortController(); pending.current = controller;
    dispatch({ type: "save", scope });
    let savedId: string | null = null;
    try {
      const [{ composerCreatePayload }, time] = await Promise.all([import("@/lib/planComposerHandoff"), import("@/lib/planIntake")]);
      const startTime = time.londonDateTimeInputToIso(last.start);
      if (!startTime) throw new Error("Invalid start");
      const payload = composerCreatePayload({ title: DEFAULT_PLAN_COMPOSER_TITLE, creatorName: name, startTime, cityId, stops: last.generated.stops, groundingProof: last.generated.groundingProof, context: last.generated.inferredContext });
      const response = await fetch("/api/plans", { method: "POST", signal: controller.signal, headers: { "content-type": "application/json", "idempotency-key": scope }, body: JSON.stringify(payload) });
      const body = await readApiJson(response) as { plan?: { plan?: { id?: unknown; inviteToken?: unknown }; inviteToken?: unknown }; memberToken?: unknown } | null;
      if (controller.signal.aborted) return;
      const id = body?.plan?.plan?.id;
      if (!response.ok || !isPlanId(id)) throw new Error("Save failed");
      if (typeof body?.memberToken === "string") writePlanCapability(id, { token: body.memberToken, collaborationAuthorized: true, role: "host" });
      savedId = id;
      dispatch({ type: "saved", scope, planId: id });
      dismissMapFirstVisitArrival(undefined, Date.now(), true);
      await prepareLink(id, body?.plan?.inviteToken ?? body?.plan?.plan?.inviteToken);
    } catch {
      if (!controller.signal.aborted) {
        if (savedId) dispatch({ type: "link", scope, url: null });
        else dispatch({ type: "notice", scope, notice: "Could not save. Your plan is still here. Try again." });
      }
    } finally { if (pending.current === controller) pending.current = null; }
  }
  const url = state.phase === "locked" && state.link.phase === "ready" ? state.link.url : null;
  function share() {
    if (!url) return;
    void shareNightObject({ title: DEFAULT_PLAN_COMPOSER_TITLE, text: "Three stops, one pint at each. Join the crew to see the route.", url }).then((outcome) => dispatch({ type: "share", scope, outcome }));
  }
  async function copy() {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); dispatch({ type: "notice", scope, notice: "Link copied" }); }
    catch { dispatch({ type: "notice", scope, notice: "Could not copy the link. Try again." }); }
  }
  return { state, url, canShare, save, share, copy, retryLink: () => { if (state.phase === "locked") void prepareLink(state.planId); } };
}
