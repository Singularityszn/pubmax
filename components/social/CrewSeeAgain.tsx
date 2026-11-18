"use client";

import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { Button } from "@/components/ui/button";
import ReportPerson from "@/components/social/ReportPerson";
import { readProviderAccountSignal } from "@/lib/authProviderRevision";
import { authedActionFetch, authedFetch } from "@/lib/authedFetch";
import { nextSeeAgainView, parseSeeAgain, type SeeAgainDTO, type SeeAgainItem } from "@/lib/crewSeeAgain";
import type { SocialCrewRole, SocialCrewVisibility } from "@/lib/socialCrew";
import { displayHandle } from "@/lib/handleDisplay";
import { discardBody } from "@/lib/responseBody";
import { useRefreshAt } from "@/lib/useRefreshAt";
import "@/components/social/crewSeeAgain.css";

type Props = { crewId: string; identityKey: string };
type FocusRequest = { origin: Element | null; memberId: string; goal: "item" | "mate" };
export default function CrewSeeAgain(props: Props & { visibility: SocialCrewVisibility; viewerRole: SocialCrewRole }) {
  if (props.visibility !== "open" || props.viewerRole !== "member") return null;
  const scope = `${props.crewId}|${props.identityKey}`;
  return <PrivateReconnection key={scope} {...props} scope={scope} />;
}
function PrivateReconnection({ crewId, scope }: Props & { scope: string }) {
  const router = useRouter();
  const path = `/api/social/crews/${encodeURIComponent(crewId)}/see-again`;
  const [view, dispatch] = useReducer(nextSeeAgainView, { phase: "loading", scope });
  const [consent, setConsent] = useState(false);
  const section = useRef<HTMLElement>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const handledFocus = useRef<FocusRequest | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [accountSignal] = useState(readProviderAccountSignal);
  const active = useRef(true), generation = useRef(0), busy = useRef(false);
  const controllers = useRef(new Set<AbortController>());
  useEffect(() => {
    active.current = true;
    const pending = controllers.current;
    const cancel = () => {
      for (const controller of pending) controller.abort();
      dispatch({ type: "hidden", scope });
    };
    accountSignal.addEventListener("abort", cancel, { once: true });
    return () => {
      active.current = false;
      accountSignal.removeEventListener("abort", cancel);
      for (const controller of pending) controller.abort();
    };
  }, [accountSignal, scope]);

  const refresh = useCallback(async (): Promise<SeeAgainDTO | null> => {
    if (accountSignal.aborted) return null;
    const attempt = ++generation.current;
    const controller = new AbortController();
    controllers.current.add(controller);
    dispatch({ type: "reset", scope });
    try {
      const response = await authedFetch(path, { cache: "no-store", signal: controller.signal }, { requiresIdentity: true });
      const data = response.ok ? parseSeeAgain(await response.json()) : null;
      if (!response.ok) discardBody(response);
      if (!active.current || accountSignal.aborted || attempt !== generation.current) return null;
      dispatch(data ? { type: "loaded", scope, data }
        : { type: response.status === 404 || response.status === 403 || response.status === 401 || response.ok ? "hidden" : "failed", scope });
      return data;
    } catch {
      if (active.current && !accountSignal.aborted && attempt === generation.current) dispatch({ type: "failed", scope });
      return null;
    } finally { controllers.current.delete(controller); }
  }, [path, scope, accountSignal]);
  const reload = useCallback(() => { if (!busy.current) void refresh(); }, [refresh]);
  useEffect(reload, [reload]);
  const ready = "data" in view;
  const waiting = view.phase !== "ready";
  const refreshAt = ready && view.data.open ? Date.parse(view.data.closesAt) : null;
  useRefreshAt({ refreshAt }, true, reload);

  useLayoutEffect(() => {
    if (!focusRequest || handledFocus.current === focusRequest || view.phase === "loading" || view.phase === "refreshing" || view.phase === "saving") return;
    handledFocus.current = focusRequest;
    if (!active.current || accountSignal.aborted || !section.current) return;
    const focused = document.activeElement;
    if (focused !== focusRequest.origin && focused !== document.body && focused?.isConnected) return;
    const row = section.current.querySelector<HTMLElement>(`[data-member-id="${focusRequest.memberId}"]`);
    const original = focusRequest.origin instanceof HTMLElement && section.current.contains(focusRequest.origin) ? focusRequest.origin : null;
    const target = view.phase === "failed" ? section.current.querySelector<HTMLButtonElement>("button")
      : focusRequest.goal === "mate" ? row?.querySelector<HTMLAnchorElement>("a")
      : original ?? row?.querySelector<HTMLElement>('button:not(:disabled)') ?? row;
    (target ?? section.current.querySelector<HTMLElement>("h2"))?.focus();
  }, [focusRequest, view, accountSignal, adding]);

  async function change(item: SeeAgainItem, action: "choose" | "withdraw") {
    if (busy.current || accountSignal.aborted || view.phase !== "ready" || (action === "choose" && !consent)) return;
    busy.current = true;
    const origin = document.activeElement;
    try {
      const current = await refresh();
      const target = current?.items.find(row => row.memberId === item.memberId);
      if (!active.current || accountSignal.aborted || !target || (action === "choose" && (!current?.open || target.choice !== "none"))) return;
      dispatch({ type: "save", scope });
      const controller = new AbortController();
      controllers.current.add(controller);
      try {
        const response = await authedActionFetch(path, { method: "POST", signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ memberId: item.memberId, context: "friendship", action, consent: action === "choose" && consent }),
        }, { requiresIdentity: true });
        discardBody(response);
        if (!active.current || accountSignal.aborted) return;
        if (!response.ok) { dispatch({ type: "failed", scope }); return; }
        await refresh();
        if (active.current && !accountSignal.aborted) dispatch({ type: "saved", scope });
      } finally { controllers.current.delete(controller); }
    } catch {
      if (active.current && !accountSignal.aborted) dispatch({ type: "failed", scope });
    } finally {
      busy.current = false;
      if (active.current && !accountSignal.aborted) setFocusRequest({ origin, memberId: item.memberId, goal: "item" });
    }
  }
  async function offerMate(item: SeeAgainItem) {
    if (busy.current || accountSignal.aborted || view.phase !== "ready") return;
    busy.current = true;
    const origin = document.activeElement;
    try {
      const current = await refresh();
      if (active.current && !accountSignal.aborted && current?.items.some(row => row.memberId === item.memberId && row.mutual)) setAdding(item.memberId);
    } finally {
      busy.current = false;
      if (active.current && !accountSignal.aborted) setFocusRequest({ origin, memberId: item.memberId, goal: "mate" });
    }
  }
  async function continueToMate(event: React.MouseEvent<HTMLAnchorElement>, item: SeeAgainItem) {
    event.preventDefault();
    if (busy.current || accountSignal.aborted || view.phase !== "ready") return;
    busy.current = true;
    const origin = document.activeElement;
    try {
      const current = await refresh();
      if (active.current && !accountSignal.aborted && current?.items.some(row => row.memberId === item.memberId && row.mutual)) {
        router.push(`/add/${encodeURIComponent(item.handle)}` as Route);
      }
    } finally {
      busy.current = false;
      if (active.current && !accountSignal.aborted) setFocusRequest({ origin, memberId: item.memberId, goal: "mate" });
    }
  }
  if (view.phase === "hidden" || view.phase === "loading") return null;
  if (view.phase === "failed") return <section ref={section} aria-label="Private reconnection">
    <p>Reconnection could not load. Your choices stay private.</p>
    <Button variant="secondary" onClick={reload}>Retry reconnection</Button>
  </section>;
  return <section ref={section} className="crews crewSeeAgain" aria-labelledby="crew-see-again-title" aria-busy={waiting}>
    <h2 tabIndex={-1} id="crew-see-again-title" className="crews__title">See a mate again</h2>
    <p>Your host marked you as here. This does not independently check who attended.</p>
    <p>Choose someone you would like to meet again as a friend. Only a mutual choice appears, privately, to the two of you.</p>
    <p className="crews__note">Choices close {new Date(view.data.closesAt).toLocaleString("en-GB", {
      timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    })} London time. A mutual reconnection stays for up to 30 days.</p>
    {view.data.open ? <label className="crews__member crewSeeAgainConsent">
      <input type="checkbox" checked={consent} aria-disabled={waiting} onChange={event => { if (!waiting) setConsent(event.target.checked); }} />
      <span>I want to reconnect as friends after this night. My choices stay private.</span>
    </label> : null}
    {view.data.items.length ? <ul className="crews__list">
      {view.data.items.map(item => <li tabIndex={-1} data-member-id={item.memberId} key={item.memberId} className="crews__member crewSeeAgainItem">
        <p className="crews__memberHandle">{displayHandle(item.handle)}</p>
        {item.mutual ? <>
          <p>You both chose to meet again as mates.</p>
          <Button variant="secondary" aria-disabled={waiting} onClick={() => void offerMate(item)}>Add {displayHandle(item.handle)} as a mate</Button>
          {adding === item.memberId ? <div>
            <p>Adding a mate follows them. Following can appear on public follower and following lists. Your private choice stays here.</p>
            <Button asChild variant="secondary"><a aria-disabled={waiting} href={`/add/${encodeURIComponent(item.handle)}`} onClick={event => void continueToMate(event, item)}>Continue to Add mate</a></Button>
            <Button variant="ghost" aria-disabled={waiting} onClick={() => { if (!waiting) setAdding(null); }}>Keep this private</Button>
          </div> : null}
        </> : item.choice === "chosen" ? <p>Your private choice is saved.</p> : null}
        {item.choice === "none" && !item.mutual && view.data.open ? <Button variant="secondary" disabled={!consent} aria-disabled={waiting}
          onClick={() => void change(item, "choose")}>See {displayHandle(item.handle)} again as a mate</Button> : null}
        {item.choice === "chosen" || item.mutual ? <Button variant="ghost" aria-disabled={waiting}
          onClick={() => void change(item, "withdraw")}>{item.mutual ? `Dismiss reconnection with ${displayHandle(item.handle)}` : `Withdraw choice for ${displayHandle(item.handle)}`}</Button> : null}
      </li>)}
    </ul> : <p>There is nobody to choose here right now.</p>}
    <p>You can withdraw a choice. A withdrawn choice cannot be offered again on this night.</p>
    <p>Adding a mate is a separate choice. Messages still use the usual mate and safety rules.</p>
    <ReportPerson handles={view.data.items.map(item => item.handle)} />
    <p role="status" aria-live="polite">{view.notice === "saved" ? "Your choice stays private." : ""}</p>
  </section>;
}
