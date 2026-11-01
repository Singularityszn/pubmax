"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { isPlanPresentation, planRevealScope, type PlanPresentation } from "@/lib/planPresentation";
import { discardBody } from "@/lib/responseBody";
import { Button } from "@/components/ui/button";
import { Mail } from "lucide-react";
import "./planNightPresentation.css";

type PresentationContext = {
  value: PlanPresentation | null;
  pending: boolean;
  message: string | null;
  revealed: readonly string[];
  reveal: (venueId: string) => void;
  showAll: () => void;
  change: (enabled: boolean) => Promise<void>;
  retry: () => void;
};
const Context = createContext<PresentationContext | null>(null);
const REVEAL_EVENT = "pubmax:plan-mystery-reveal";
const volatileReveals = new Map<string, string>();
const revealOwners = new Map<string, number>();

function storedReveals(key: string | null): string {
  if (!key) return "[]";
  try { return sessionStorage.getItem(key) ?? volatileReveals.get(key) ?? "[]"; } catch { return volatileReveals.get(key) ?? "[]"; }
}

function forgetReveals(key: string | null) {
  if (!key) return;
  volatileReveals.delete(key);
  try { sessionStorage.removeItem(key); } catch { /* Storage can be unavailable. */ }
  window.dispatchEvent(new Event(REVEAL_EVENT));
}

function parseReveals(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 12) : [];
  } catch { return []; }
}

async function requestPresentation(url: string, options: RequestInit, controller: AbortController): Promise<unknown> {
  let rejectCancelled: () => void = () => undefined;
  const cancelled = new Promise<never>((_, reject) => { rejectCancelled = () => reject(new Error("request-ended")); });
  controller.signal.addEventListener("abort", rejectCancelled, { once: true });
  const timeout = setTimeout(() => controller.abort(), 8_000);
  const read = async () => {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (controller.signal.aborted || !response.ok) { discardBody(response); throw new Error("unavailable"); }
    return response.json();
  };
  try { return await Promise.race([read(), cancelled]); }
  finally {
    clearTimeout(timeout);
    controller.signal.removeEventListener("abort", rejectCancelled);
  }
}

export function usePlanNightPresentation() { return useContext(Context); }

export default function PlanNightPresentation({ planId, memberToken, ownerKey, revision, children }: {
  planId: string; memberToken: string; ownerKey: string; revision: number; children: ReactNode;
}) {
  const scope = `${planId}:${ownerKey}:${memberToken}:${revision}`;
  const currentScope = useRef(scope);
  const [read, setRead] = useState<{ scope: string; value: PlanPresentation | null; message: string | null } | null>(null);
  const [pendingScope, setPendingScope] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const active = useRef(true);
  const writing = useRef(false);
  const requestVersion = useRef(0);
  const value = read?.scope === scope ? read.value : null;
  const storageKey = value ? planRevealScope(planId, value.memberId, ownerKey, value.routeRevision) : null;
  const event = `pubmax:plan-presentation:${planId}`;

  useEffect(() => {
    active.current = true;
    currentScope.current = scope;
    return () => {
      active.current = false;
      requestVersion.current += 1;
    };
  }, [scope]);

  useEffect(() => {
    if (!storageKey) return;
    revealOwners.set(storageKey, (revealOwners.get(storageKey) ?? 0) + 1);
    return () => {
      const remaining = (revealOwners.get(storageKey) ?? 1) - 1;
      if (remaining > 0) revealOwners.set(storageKey, remaining);
      else { revealOwners.delete(storageKey); forgetReveals(storageKey); }
    };
  }, [storageKey]);

  useEffect(() => {
    if (!memberToken) return;
    let mounted = true;
    const version = ++requestVersion.current;
    const controller = new AbortController();
    void requestPresentation(`/api/plans/${planId}/presentation`, {
      cache: "no-store", headers: { authorization: `Bearer ${memberToken}` },
    }, controller).then((body) => {
      if (!isPlanPresentation(body) || body.routeRevision !== revision) throw new Error("changed");
      if (mounted && !controller.signal.aborted && version === requestVersion.current) setRead({ scope, value: body, message: null });
    }).catch(() => {
      if (mounted && active.current && currentScope.current === scope && version === requestVersion.current) setRead({ scope, value: null, message: "Mystery settings could not be read. The full route is available." });
    });
    return () => { mounted = false; controller.abort(); };
  }, [planId, memberToken, scope, revision, tick]);

  useEffect(() => {
    const refresh = () => setTick((n) => n + 1);
    window.addEventListener(event, refresh);
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 30_000);
    return () => { window.clearInterval(timer); window.removeEventListener(event, refresh); window.removeEventListener("focus", refresh); };
  }, [event]);

  const subscribe = useCallback((notify: () => void) => {
    window.addEventListener(REVEAL_EVENT, notify);
    window.addEventListener("storage", notify);
    return () => { window.removeEventListener(REVEAL_EVENT, notify); window.removeEventListener("storage", notify); };
  }, []);
  const raw = useSyncExternalStore(subscribe, () => storedReveals(storageKey), () => "[]");
  const revealed = parseReveals(raw);

  function reveal(venueId: string) {
    if (!storageKey) return;
    const ids = [...new Set([...revealed, venueId])];
    volatileReveals.set(storageKey, JSON.stringify(ids));
    try { sessionStorage.setItem(storageKey, JSON.stringify(ids)); } catch { /* Keep the reveal usable in memory. */ }
    window.dispatchEvent(new Event(REVEAL_EVENT));
  }

  async function change(enabled: boolean) {
    if (!value?.canEdit || writing.current) return;
    writing.current = true;
    const version = ++requestVersion.current;
    setPendingScope(scope);
    const controller = new AbortController();
    try {
      const body = await requestPresentation(`/api/plans/${planId}/presentation`, {
        method: "PUT", cache: "no-store",
        headers: { authorization: `Bearer ${memberToken}`, "content-type": "application/json" },
        body: JSON.stringify({ mysteryEnabled: enabled, expectedRouteRevision: revision }),
      }, controller);
      if (!isPlanPresentation(body)) throw new Error("invalid");
      if (!active.current || currentScope.current !== scope) return;
      if (version === requestVersion.current) setRead({ scope, value: body, message: enabled ? "Mystery envelopes are on. Everyone can still open the full route." : "The full route is shown." });
      window.dispatchEvent(new Event(event));
    } catch {
      if (active.current && currentScope.current === scope && version === requestVersion.current) setRead({ scope, value: null, message: "The setting was not confirmed. Refresh before trying again." });
    } finally {
      writing.current = false;
      if (active.current && currentScope.current === scope) setPendingScope(null);
    }
  }

  return <Context.Provider value={{ value, pending: pendingScope === scope, message: read?.scope === scope ? read.message : null,
    revealed, reveal, showAll: () => reveal("*"), change, retry: () => setTick((n) => n + 1) }}>{children}</Context.Provider>;
}

export function PlanMysteryControls() {
  const context = usePlanNightPresentation();
  if (!context) return null;
  const { value, pending, message } = context;
  return <section className="planMystery" aria-label="Mystery envelopes">
    <div className="planMystery__heading"><h3>Mystery envelopes</h3>
      {value?.canEdit ? <Button type="button" variant="secondary" aria-pressed={value.mysteryEnabled} disabled={pending}
        onClick={() => void context.change(!value.mysteryEnabled)}>{pending ? "Saving…" : value.mysteryEnabled ? "Turn off mystery envelopes" : "Turn on mystery envelopes"}</Button> : null}
    </div>
    <p>{value?.mysteryEnabled ? "Open each stop when you are ready. Prices, access information and the full map stay available." : "The host can turn each next stop into a small surprise. The full route is always available."}</p>
    {value?.mysteryEnabled ? <Button type="button" variant="secondary" onClick={context.showAll}>Show full route</Button> : null}
    {message ? <p role="status">{message} {!value ? <Button type="button" variant="secondary" onClick={context.retry}>Retry settings</Button> : null}</p> : null}
  </section>;
}

export function MysteryStopTitle({ venueId, name, position, alreadyVisited = false }: {
  venueId: string; name: string; position: number; alreadyVisited?: boolean;
}) {
  const context = usePlanNightPresentation();
  const hidden = context?.value?.mysteryEnabled && position > 0 && !alreadyVisited
    && !context.revealed.includes("*") && !context.revealed.includes(venueId);
  if (!hidden) return <strong className="planMystery__revealed">{name}</strong>;
  return <Button type="button" variant="secondary" className="planMystery__envelope" onClick={() => context.reveal(venueId)}>
    <Mail size={20} aria-hidden="true" /> Open stop {position + 1}
  </Button>;
}

export function MysteryGlanceLine({ venueId, position, alreadyVisited = false, children }: { venueId?: string; position: number; alreadyVisited?: boolean; children: ReactNode }) {
  const context = usePlanNightPresentation();
  if (venueId && position > 0 && !alreadyVisited && context?.value?.mysteryEnabled && !context.revealed.includes("*") && !context.revealed.includes(venueId)) {
    return <>Stop {position + 1} is sealed below.</>;
  }
  return <>{children}</>;
}
