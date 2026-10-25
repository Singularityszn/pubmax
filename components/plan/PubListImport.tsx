"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type RefObject, type ComponentProps } from "react";

import { useAuth } from "@/components/auth/authContext";
import { useViewerSession, type ViewerSession } from "@/components/auth/useViewerSession";
import { probeWebGl2 } from "@/components/map/canvas/webgl";
import { Button } from "@/components/ui/button";
import PlanTuneSheet from "@/components/plan/PlanTuneSheet";
import { trackEvent } from "@/lib/analytics";
import { authedActionJson } from "@/lib/authedFetch";
import { transferGeneratedRouteToDraft, type MapGeneratedRouteResponse } from "@/lib/mapRouteTransfer";
import { planCrawlRouteGeoJSON } from "@/lib/planCrawlRouteMap";
import type { ImportCandidate, ImportItem, ImportSource } from "@/lib/pubListImport";
import type { PubListNightDraft } from "@/lib/pubListImport";
import type { LngLat } from "@/lib/routeMiniMap";
import { safeLocalStorage } from "@/lib/safeStorage";

import "./pubListImport.css";

const ListMapCanvas = dynamic(() => import("@/components/map/canvas/PlanCrawlRouteMapCanvas"), { ssr: false });

function ListMap(props: ComponentProps<typeof ListMapCanvas>) {
  const [canDraw, setCanDraw] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    const supported = probeWebGl2().hasContext;
    void Promise.resolve().then(() => { if (active) setCanDraw(supported); });
    return () => { active = false; };
  }, []);
  if (canDraw === null) return <p>Loading the map…</p>;
  return canDraw ? <ListMapCanvas {...props} /> : <p>The map cannot load on this device. Your matched pubs are still listed above.</p>;
}

type ReviewItem = ImportItem & { edited?: true };
type Review = { restored?: boolean; importId: string; source: ImportSource | null; items: ReviewItem[]; truncated: boolean; missingCount?: number };
type Cluster = { venueIds: string[]; remainingIds: string[]; distanceBasis: string; nightArea: string | null };
type Generated = MapGeneratedRouteResponse & { grounded?: boolean; error?: string; message?: string };

export default function PubListImport() {
  const { user } = useAuth();
  const { phase } = useViewerSession();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return <div className="pubImportDoor">
    <Button ref={triggerRef} type="button" variant="secondary" onClick={() => setOpen(true)}>Import a pub list</Button>
    {open ? <ImportSession key={user?.id ?? phase} phase={phase} returnFocusRef={triggerRef} onClose={() => setOpen(false)} /> : null}
  </div>;
}

export function ImportSession({ phase, onClose, returnFocusRef }: { phase: ViewerSession["phase"]; onClose: () => void; returnFocusRef?: RefObject<HTMLElement | null> }) {
  const [text, setText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [drafts, setDrafts] = useState<PubListNightDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [edit, setEdit] = useState<{ index: number; text: string } | null>(null);
  const [route, setRoute] = useState<Generated | null>(null);
  const [mapShown, setMapShown] = useState(true);
  const abort = useRef<AbortController | null>(null);
  const gate = useRef(false);
  const reviewIntroRef = useRef<HTMLParagraphElement>(null);
  const routeHeadingRef = useRef<HTMLHeadingElement>(null);
  const signedIn = phase === "signed-in";

  useEffect(() => { reviewIntroRef.current?.focus(); }, [review?.importId]);
  useEffect(() => { if (route) routeHeadingRef.current?.focus(); }, [route]);

  useEffect(() => {
    if (!signedIn) return;
    const controller = new AbortController();
    void authedActionJson<{ drafts?: PubListNightDraft[]; error?: string }>("/api/pub-list-import", {
      method: "GET", signal: controller.signal,
    }, { requiresIdentity: true }).then(({ response, body }) => {
      if (response.ok) setDrafts(body.drafts ?? []);
      else setMessage(body.error ?? "Your night drafts are unavailable.");
    }).catch(() => { if (!controller.signal.aborted) setMessage("Your night drafts are unavailable."); });
    return () => { controller.abort(); abort.current?.abort(); };
  }, [signedIn]);

  async function request<T>(body: unknown, url = "/api/pub-list-import"): Promise<T> {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const result = await authedActionJson<T & { error?: string }>(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body), signal: controller.signal,
    }, { requiresIdentity: true });
    if (!result.response.ok) throw new Error(result.body.error ?? "That did not work. Try again.");
    return result.body;
  }

  async function act(work: () => Promise<void>) {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    setMessage("");
    try { await work(); }
    catch (error) {
      if (!abort.current?.signal.aborted) setMessage(error instanceof Error ? error.message : "That did not work. Try again.");
    } finally { gate.current = false; setBusy(false); }
  }

  const unresolved = review?.items.some((item) => item.state === "ambiguous") ?? false;
  const selected = useMemo(() => review?.items.flatMap((item) => item.state === "matched" || item.state === "closed" ? [item.venue] : []) ?? [], [review]);
  const unique = useMemo(() => [...new Map(selected.map((venue) => [venue.id, venue])).values()], [selected]);
  const routable = unique.filter((venue) => !venue.closed && venue.layer === "curated");
  const located = useMemo(() => unique.filter((venue): venue is ImportCandidate & { lat: number; lng: number } =>
    Number.isFinite(venue.lat) && Number.isFinite(venue.lng)), [unique]);
  const coords = useMemo<LngLat[]>(() => located.map((venue) => [venue.lng, venue.lat]), [located]);
  const points = useMemo(() => planCrawlRouteGeoJSON({ coords, names: located.map((venue) => venue.name), venueIds: located.map((venue) => venue.id), area: "" }, [], "straight"), [coords, located]);
  const routeIds = Array.isArray(route?.stops) ? route.stops.map((stop) => stop.venueId) : [];
  const remaining = unique.filter((venue) => !routeIds.includes(venue.id));

  function updateItems(items: ReviewItem[]) {
    if (!review) return;
    setReview({ ...review, items });
    setRoute(null);
  }

  async function match() {
    await act(async () => {
      trackEvent("pub_list_import_started", { input_kind: "pasted_text" });
      const result = await request<Review>({ text, ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}) });
      setReview(result);
      setText("");
      setSourceUrl("");
      setRoute(null);
      trackEvent("pub_list_import_matched", {
        count_matched: result.items.filter((item) => item.state === "matched").length,
        count_ambiguous: result.items.filter((item) => item.state === "ambiguous").length,
        count_unmatched: result.items.filter((item) => item.state === "unmatched").length,
      });
    });
  }

  async function plan() {
    await act(async () => {
      setRoute(null);
      const cluster = await request<Cluster>({ action: "cluster", venueIds: routable.map((venue) => venue.id) });
      if (cluster.venueIds.length < 3 || !cluster.nightArea) {
        setMessage("These pubs are too spread out for a crawl. Save them for another night.");
        return;
      }
      const result = await request<Generated>({
        cityId: "london", query: "A crawl from my pub list",
        context: { nightArea: cluster.nightArea, stopCount: cluster.venueIds.length },
        anchor: { venueId: cluster.venueIds[0], source: "map-search", acceptedArea: null, startsAt: null, venueIds: cluster.venueIds },
      }, "/api/plans/generate");
      const stops = result.stops ?? [];
      if (result.outcome !== "route" || result.grounded !== true || result.anchored !== true
        || result.anchorVenueId !== cluster.venueIds[0] || stops[0]?.venueId !== cluster.venueIds[0]
        || result.anchorSource !== "map-search" || typeof result.groundingProof !== "string"
        || stops.length !== cluster.venueIds.length || new Set(stops.map((stop) => stop.venueId)).size !== stops.length
        || stops.some((stop) => !cluster.venueIds.includes(String(stop.venueId)))) {
        throw new Error(result.message ?? "We could not make a crawl from these pubs. Your list is still here.");
      }
      setRoute(result);
      trackEvent("pub_list_import_routed", { stops: stops.length });
    });
  }

  return <PlanTuneSheet open title="Import a pub list" onClose={onClose} returnFocusRef={returnFocusRef}>
    <div className="pubImport">
      {phase === "unresolved" ? <p>With you in a sec.</p> : phase === "signed-out" ? <p><a href="/login?next=%2Fplan">Sign in to import a pub list</a>. Your notes stay yours.</p> : <>
        {!review ? <>
          <p>Turn a caption, a note or a message into a night out.</p>
          <label htmlFor="pub-import-text">Paste your pub list</label>
          <textarea id="pub-import-text" rows={6} maxLength={4000} value={text} onChange={(event) => setText(event.target.value)} disabled={busy} aria-describedby="pub-import-privacy" />
          <p id="pub-import-privacy">Up to 4,000 characters. We discard your pasted text after matching. Short prose may go to our text-matching provider.</p>
          <label htmlFor="pub-import-source">Original post link (optional)</label>
          <input id="pub-import-source" type="url" inputMode="url" value={sourceUrl} maxLength={2048} onChange={(event) => setSourceUrl(event.target.value)} disabled={busy} aria-describedby="pub-import-link-help" />
          <p id="pub-import-link-help">We keep the credit. We never open the link.</p>
          <Button type="button" onClick={() => void match()} disabled={busy || !text.trim()}>Match these pubs</Button>
          {drafts.length ? <section aria-label="Saved night drafts"><h3>Your saved night drafts</h3><ul>{drafts.map((draft) => <li key={draft.id}>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => void act(async () => {
              const result = await request<Review>({ action: "resume", importId: draft.id });
              setReview(result); setRoute(null); setEdit(null); setMapShown(true);
            })}>{draft.venueIds.length} pubs{draft.source?.handle ? ` from ${draft.source.handle}` : ""} · {new Date(draft.createdAt).toLocaleDateString("en-GB")}</Button>
          </li>)}</ul></section> : null}
        </> : <>
          <p ref={reviewIntroRef} tabIndex={-1}>{review.items.length} lines to review. Choose a pub where a name could mean more than one.</p>
          {review.source ? <p>List credit: <a href={review.source.url} target="_blank" rel="noreferrer noopener">{review.source.handle ?? "Original post"}</a></p> : null}
          {review.truncated ? <p>We kept the first 40 lines. Import the rest as another list.</p> : null}
          {review.missingCount ? <p>{review.missingCount} saved pubs are no longer listed. We kept their IDs in your draft.</p> : null}
          <ol className="pubImport__lines">{review.items.map((item, index) => <li key={index}>
            <h3>{index + 1}. {item.name}</h3>
            <p className="pubImport__state">{item.state === "matched" ? "Matched" : item.state === "ambiguous" ? "Choose the pub" : item.state === "closed" ? "Closed" : "We couldn't find this one"}</p>
            {"venue" in item ? <p>{item.venue.layer === "curated" ? <a href={`/map?sel=${encodeURIComponent(item.venue.id)}`}>{item.venue.name}</a> : item.venue.name} · {item.venue.area}{(item.venue.layer === "national" || item.venue.hasPrice === false) ? " · No price listed" : ""}</p> : null}
            <blockquote><p>{item.rawLine}</p><cite>{review.restored ? "From your saved draft" : item.edited ? "Your edited line" : review.source?.handle ? `Quoted from ${review.source.handle}` : "From your pasted text"}</cite></blockquote>
            {item.state === "ambiguous" ? <>
              <label htmlFor={`pub-import-choice-${index}`}>Which {item.name}?</label>
              <select id={`pub-import-choice-${index}`} value="" disabled={busy || edit !== null} onChange={(event) => {
                const venue = item.candidates.find((candidate) => candidate.id === event.target.value);
                if (venue) updateItems(review.items.map((row, i) => i === index ? { rawLine: item.rawLine, name: item.name, areaHint: item.areaHint, ...(item.edited ? { edited: true as const } : {}), state: venue.closed ? "closed" : "matched", venue } : row));
              }}><option value="">Choose a pub</option>{item.candidates.map((venue) => <option key={venue.id} value={venue.id}>{venue.name} · {venue.area}{venue.postcodeDistrict ? ` ${venue.postcodeDistrict}` : ""}{venue.closed ? " · Closed" : ""}</option>)}</select>
              {item.candidateCount > item.candidates.length ? <p>More pubs share this name. Add an area to narrow it down.</p> : null}
            </> : null}
            {item.state === "unmatched" ? <a href={`/add-a-pub?name=${encodeURIComponent(item.name)}`}>Suggest this pub</a> : null}
            {edit?.index === index ? <div>
              <label htmlFor="pub-import-edit">Edit line {index + 1}</label>
              <input id="pub-import-edit" value={edit.text} maxLength={4000} disabled={busy} onChange={(event) => setEdit({ index, text: event.target.value })} />
              <Button type="button" variant="secondary" disabled={busy || !edit.text.trim()} onClick={() => void act(async () => {
                const result = await request<Review>({ text: edit.text });
                const replacement = result.items[0];
                if (result.items.length !== 1 || !replacement) throw new Error("Keep one pub on this line.");
                updateItems(review.items.map((row, i) => i === index ? { ...replacement, edited: true } : row)); setEdit(null);
              })}>Match edited line</Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setEdit(null)}>Cancel edit</Button>
            </div> : <div className="pubImport__rowActions">
              <Button type="button" variant="ghost" disabled={busy || edit !== null} aria-label={`Edit line ${index + 1}`} onClick={() => { setEdit({ index, text: item.rawLine }); setRoute(null); }}>Edit</Button>
              <Button type="button" variant="ghost" disabled={busy || edit !== null} aria-label={`Remove line ${index + 1}`} onClick={() => updateItems(review.items.filter((_, i) => i !== index))}>Remove</Button>
            </div>}
          </li>)}</ol>
          {mapShown && located.length ? <section aria-label="Imported pubs on the map">
            <h3>Your listed pubs</h3><p>The numbers follow the matched pubs in your list. They do not show a route.</p>
            <div className="pubImport__map"><ListMap stopCoords={coords} routeLine={points.routeLine} routeStops={points.routeStops} lineCoords={[]} /></div>
            <Button type="button" variant="ghost" onClick={() => setMapShown(false)}>Dismiss map highlights</Button>
          </section> : null}
          {unresolved ? <p>Choose a pub or remove each unclear line before planning or saving.</p> : null}
          <p>Closed pubs stay in the list. Only matched London pubs can join a crawl. Prices and opening hours come from PUBMAXX.</p>
          {routable.length < 3 ? <p>Match at least three London pubs to plan a crawl.</p> : null}
          <div className="pubImport__actions">
            <Button type="button" variant={route ? "secondary" : "primary"} disabled={busy || edit !== null || unresolved || routable.length < 3} onClick={() => void plan()}>Plan a crawl from these</Button>
            <Button type="button" variant="secondary" disabled={busy || edit !== null || unresolved || unique.length === 0} onClick={() => void act(async () => {
              const { draft } = await request<{ draft: PubListNightDraft }>({ action: "save", importId: review.importId, venueIds: unique.map((venue) => venue.id), ...(review.source ? { sourceUrl: review.source.url } : {}) });
              setDrafts((current) => [draft, ...current.filter((held) => held.id !== draft.id)]);
              setMessage(`Saved as a night draft with ${draft.venueIds.length} matched pubs. Unmatched lines and pasted text are not saved.`);
            })}>Save</Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => { setReview(null); setEdit(null); setRoute(null); }}>Import another list</Button>
          </div>
          {route ? <section aria-label="Your imported crawl">
            <h3 ref={routeHeadingRef} tabIndex={-1}>{routeIds.length} of {unique.length} matched pubs in this crawl</h3>
            <ol>{route.stops?.map((stop) => <li key={String(stop.venueId)}>{String(stop.venueName)}</li>)}</ol>
            {remaining.length ? <><h3>For another night</h3><ul>{remaining.map((venue) => <li key={venue.id}>{venue.name} · {venue.area}{venue.closed ? " · Closed" : ""}</li>)}</ul></> : null}
            <p>Review prices, hours and the walking estimate in your plan before you go.</p>
            <Button type="button" onClick={() => {
              if (!transferGeneratedRouteToDraft(route, safeLocalStorage())) { setMessage("Your browser could not keep this crawl. Try again."); return; }
              // The composer reads the route draft once on mount, so this needs a document navigation.
              window.location.assign(new URL("/plan", window.location.origin).href);
            }}>Review this crawl</Button>
          </section> : null}
        </>}
      </>}
      <p role="status" aria-live="polite">{busy ? "Working on your list…" : message}</p>
    </div>
  </PlanTuneSheet>;
}
