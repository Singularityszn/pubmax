"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/authContext";
import { readComparisonDraft, saveComparisonDraft } from "@/lib/pubComparisonDraft";
import { trackEvent } from "@/lib/analytics";
import { categoryLabel } from "@/lib/drinks";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import {
  comparisonDrinkKey, PUB_COMPARISON_MAX_LINES, PUB_COMPARISON_MAX_QUANTITY, PUB_COMPARISON_MAX_VENUES,
  type PubComparisonCatalogue, type PubComparisonOrderLine, type PubComparisonRequest, type PubComparisonResponse,
} from "@/lib/pubComparison";
import PubComparisonResults from "./PubComparisonResults";

type SearchHit = { id: string; name: string; area: string };
type SearchState = { query: string; hits: SearchHit[]; message: string };

export default function PubComparisonForm() {
  const { user, accountRevision, identityResolved } = useAuth();
  return <ComparisonSession key={`${accountRevision}:${user?.id ?? "guest"}`} owner={identityResolved ? user?.id ?? "guest" : null} />;
}

function ComparisonSession({ owner }: { owner: string | null }) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ query: "", hits: [], message: "" });
  const [selected, setSelected] = useState<SearchHit[]>([]);
  const [catalogue, setCatalogue] = useState<{ key: string; value: PubComparisonCatalogue } | null>(null);
  const [catalogueError, setCatalogueError] = useState<{ key: string; message: string } | null>(null);
  const [reload, setReload] = useState(0);
  const [drinkKey, setDrinkKey] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [order, setOrder] = useState<PubComparisonOrderLine[]>([]);
  const [meetingPointId, setMeetingPointId] = useState("");
  const [result, setResult] = useState<{ key: string; value: PubComparisonResponse } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submitRef = useRef<AbortController | null>(null);
  const viewedRef = useRef(false);
  const restoredOwnerRef = useRef<string | null>(null);
  const inputsChangedRef = useRef(false);
  const venueKey = selected.map((venue) => venue.id).join(",");
  const currentCatalogue = catalogue?.key === venueKey ? catalogue.value : null;
  const currentCatalogueError = catalogueError?.key === venueKey ? catalogueError.message : null;
  const request = useMemo<PubComparisonRequest>(() => ({
    venueIds: selected.map((venue) => venue.id), order,
    ...(meetingPointId ? { meetingPointId } : {}),
  }), [selected, order, meetingPointId]);
  const requestKey = JSON.stringify(request);
  const visibleResult = result?.key === requestKey ? result.value : null;
  const chosenDrink = currentCatalogue?.drinks.find((drink) => drink.key === drinkKey);
  const alreadyAdded = chosenDrink && order.some((line) => comparisonDrinkKey(line) === chosenDrink.key);

  useEffect(() => {
    if (!viewedRef.current) { viewedRef.current = true; trackEvent("pub_comparison_viewed"); }
    return () => submitRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!owner || restoredOwnerRef.current === owner) return;
    const draft = readComparisonDraft(owner);
    if (!draft) return;
    let active = true;
    void Promise.resolve().then(() => {
      if (!active || inputsChangedRef.current) return;
      restoredOwnerRef.current = owner;
      setSelected(draft.venueIds.map((id) => ({ id, name: "Selected pub", area: "" })));
      setOrder(draft.order);
      setMeetingPointId(draft.meetingPointId ?? "");
    });
    return () => { active = false; };
  }, [owner]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetch(`/api/venue-search?q=${encodeURIComponent(trimmed)}&scope=pub-comparison`, { signal: controller.signal })
        .then(async (response) => {
          const body = await response.json();
          if (!response.ok) throw new Error(errorMessageFrom(body, "Could not search pubs."));
          const hits: SearchHit[] = Array.isArray(body.venues) ? body.venues.filter((hit: SearchHit) =>
            typeof hit.id === "string" && typeof hit.name === "string" && typeof hit.area === "string") : [];
          if (!controller.signal.aborted) setSearch({ query: trimmed, hits, message: "" });
        }).catch(() => {
          if (!controller.signal.aborted) setSearch({ query: trimmed, hits: [], message: offlineOrMessage("Could not search pubs. Try another search.") });
        });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/pub-comparison${venueKey ? `?venues=${encodeURIComponent(venueKey)}` : ""}`, {
      signal: controller.signal, cache: "no-store",
    }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(errorMessageFrom(body, "Could not read the listed drinks."));
      if (!controller.signal.aborted) {
        setCatalogue({ key: venueKey, value: body });
        setCatalogueError(null);
      }
    }).catch((cause) => {
      if (!controller.signal.aborted) setCatalogueError({ key: venueKey, message: offlineOrMessage(cause instanceof Error
        ? cause.message : "Could not read the listed drinks. Try again.") });
    });
    return () => controller.abort();
  }, [venueKey, reload]);

  function changeInputs(work: () => void) {
    inputsChangedRef.current = true;
    submitRef.current?.abort();
    submitRef.current = null;
    setBusy(false);
    setError("");
    work();
  }

  async function compare(event: FormEvent) {
    event.preventDefault();
    if (selected.length < 2 || !order.length || busy || submitRef.current) return;
    const controller = new AbortController();
    submitRef.current = controller;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/pub-comparison", {
        method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
        body: JSON.stringify(request), signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(errorMessageFrom(body, "Could not compare this order."));
      if (controller.signal.aborted) return;
      setResult({ key: requestKey, value: body });
      if (owner) saveComparisonDraft(request, owner);
      trackEvent(body.completeVenueCount >= 2 ? "pub_comparison_ready" : "pub_comparison_incomplete");
    } catch (cause) {
      if (!controller.signal.aborted) setError(offlineOrMessage(cause instanceof Error ? cause.message : "Could not compare this order. Try again."));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      if (submitRef.current === controller) submitRef.current = null;
    }
  }

  return <>
    <form className="pubComparisonForm" onSubmit={(event) => void compare(event)}>
      <fieldset>
        <legend>Choose two or three pubs</legend>
        <p>Search London pubs by name. Check the branch before you compare.</p>
        <label htmlFor="comparison-pub-search">Pub name</label>
        <input id="comparison-pub-search" type="search" maxLength={80} value={query} autoComplete="off"
          onChange={(event) => setQuery(event.target.value)} />
        {query.trim().length >= 2 ? <div aria-live="polite">
          {search.query !== query.trim() ? <p>Searching pubs…</p> : search.message ? <p role="alert">{search.message}</p>
            : search.hits.length === 0 ? <p>No London pubs matched that name.</p> : <ul className="pubComparisonChoices" aria-label="Pub search results">
              {search.hits.map((hit) => <li key={hit.id}><Button variant="secondary" type="button"
                disabled={selected.length >= PUB_COMPARISON_MAX_VENUES || selected.some((row) => row.id === hit.id)}
                onClick={() => changeInputs(() => { setSelected((rows) => [...rows, hit]); setQuery(""); })}>
                Add {hit.name}{hit.area ? `, ${hit.area}` : ""}
              </Button></li>)}
            </ul>}
        </div> : null}
        <ul className="pubComparisonSelected" aria-label="Selected pubs">
          {selected.map((hit) => {
            const venue = currentCatalogue?.venues.find((row) => row.id === hit.id);
            return <li key={hit.id}><span>{venue?.name ?? hit.name}{venue?.address ? `, ${venue.address}` : hit.area ? `, ${hit.area}` : ""}</span>
              <Button variant="ghost" type="button" aria-label={`Remove ${venue?.name ?? hit.name}${venue?.address ? `, ${venue.address}` : ""}`}
                onClick={() => changeInputs(() => setSelected((rows) => rows.filter((row) => row.id !== hit.id)))}>Remove</Button>
            </li>;
          })}
        </ul>
      </fieldset>

      {currentCatalogueError ? <div role="alert"><p>{currentCatalogueError}</p><p>Remove an unavailable pub or retry the read.</p><Button variant="secondary" type="button" onClick={() => setReload((value) => value + 1)}>Retry listed drinks</Button></div> : null}
      {selected.length > 0 ? <fieldset>
        <legend>Compare your order</legend>
        <p>Choose exact drinks and servings. Alcohol-free drinks, soft drinks and coffee appear when a menu records them.</p>
        {!currentCatalogue ? currentCatalogueError ? null : <p role="status">Loading listed drinks…</p> : currentCatalogue.drinks.length === 0 ? <p>No comparable named drinks and servings are recorded for these pubs. Choose another pub or open its menu.</p>
          : <>
            {currentCatalogue.coverage === "partial" ? <p>Some price records could not be read. The available choices may be incomplete.</p> : null}
            <label htmlFor="comparison-drink">Drink and serving</label>
            <select id="comparison-drink" value={chosenDrink ? drinkKey : ""} onChange={(event) => setDrinkKey(event.target.value)}>
              <option value="">Choose a listed drink</option>
              {currentCatalogue.drinks.map((drink) => <option key={drink.key} value={drink.key}>{categoryLabel(drink.category)}: {drink.drinkLabel}, {drink.serving}</option>)}
            </select>
            <label htmlFor="comparison-quantity">Number in your order</label>
            <input id="comparison-quantity" type="number" min={1} max={PUB_COMPARISON_MAX_QUANTITY} step={1} value={quantity}
              onChange={(event) => setQuantity(Number(event.target.value))} />
            <Button variant="secondary" type="button" disabled={!chosenDrink || Boolean(alreadyAdded) || order.length >= PUB_COMPARISON_MAX_LINES
              || !Number.isInteger(quantity) || quantity < 1 || quantity > PUB_COMPARISON_MAX_QUANTITY}
              onClick={() => { if (chosenDrink) changeInputs(() => setOrder((lines) => [...lines, {
                category: chosenDrink.category, drinkLabel: chosenDrink.drinkLabel, serving: chosenDrink.serving, quantity,
              }])); }}>Add to order</Button>
          </>}
        <ul className="pubComparisonSelected" aria-label="Your order">
          {order.map((line) => <li key={comparisonDrinkKey(line)}>
            <span>{line.quantity} × {line.drinkLabel}, {line.serving}</span>
            <Button variant="ghost" type="button" aria-label={`Remove ${line.drinkLabel}, ${line.serving}`}
              onClick={() => changeInputs(() => setOrder((lines) => lines.filter((row) => comparisonDrinkKey(row) !== comparisonDrinkKey(line))))}>Remove</Button>
          </li>)}
        </ul>
      </fieldset> : null}

      <fieldset>
        <legend>Compare the walk</legend>
        <label htmlFor="comparison-meeting-point">Public meeting point, optional</label>
        <select id="comparison-meeting-point" value={meetingPointId} onChange={(event) => changeInputs(() => setMeetingPointId(event.target.value))}>
          <option value="">Compare prices only</option>
          {currentCatalogue?.meetingPoints.map((point) => <option key={point.id} value={point.id}>{point.name}</option>)}
        </select>
        <p>Your last submitted order stays in this tab for up to two hours, so you can return from the map. PUBMAXX sends your choices to its comparison service but does not save an order on its servers or create a round.</p>
        <p>If your browser blocks tab storage, keep this page open to retain your choices.</p>
      </fieldset>
      <Button type="submit" data-primary-action="" disabled={selected.length < 2 || order.length === 0 || busy}>{busy ? "Comparing…" : "Compare these pubs"}</Button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
    {visibleResult ? <PubComparisonResults key={requestKey} result={visibleResult} /> : null}
  </>;
}
