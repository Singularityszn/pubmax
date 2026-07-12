"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { laneSourceFromSearch, trackEvent } from "@/lib/analytics";
import { CREW_NAME_MAX } from "@/lib/crew";
import { PLAN_TEMPLATES, type PlanTemplate } from "@/lib/planTemplates";
import { stopsFromConcierge } from "@/components/plan/planPresentation";

type DraftStop = { key: number; venueId: string; venueName: string };
type VenueOption = { id: string; name: string; address?: string };

function nextEvening(): string {
  const date = new Date();
  date.setMinutes(Math.ceil((date.getMinutes() + 15) / 15) * 15, 0, 0);
  if (date.getHours() < 17) date.setHours(18, 0, 0, 0);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default function PlanComposer() {
  const router = useRouter();
  const [title, setTitle] = useState("Tonight, sorted");
  const [creatorName, setCreatorName] = useState("");
  const [startTime, setStartTime] = useState(nextEvening);
  const [stops, setStops] = useState<DraftStop[]>([
    { key: 1, venueId: "", venueName: "" },
    { key: 2, venueId: "", venueName: "" },
  ]);
  const [venues, setVenues] = useState<VenueOption[]>([]);
  const [conciergeQuery, setConciergeQuery] = useState("");
  const [conciergeNote, setConciergeNote] = useState("");
  const [sorting, setSorting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const completeStops = useMemo(
    () => stops.filter((stop) => stop.venueName.trim() && stop.venueId.trim()),
    [stops],
  );

  useEffect(() => {
    let active = true;
    fetch("/data/venues_slim.json")
      .then((response) => response.json())
      .then((rows: VenueOption[]) => { if (active && Array.isArray(rows)) setVenues(rows); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  function chooseVenue(key: number, venueName: string) {
    const match = venues.find((venue) => venue.name.toLocaleLowerCase() === venueName.trim().toLocaleLowerCase());
    setStops((current) => current.map((stop) => stop.key === key
      ? { ...stop, venueName, venueId: match?.id ?? "" }
      : stop));
  }

  async function sortWithConcierge() {
    if (!conciergeQuery.trim()) return;
    setSorting(true);
    setError("");
    try {
      const response = await fetch("/api/concierge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: conciergeQuery, limit: 3, narrated: true }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "The concierge could not sort this one.");
      const suggested = stopsFromConcierge(Array.isArray(body?.venues) ? body.venues : []);
      if (!suggested.length) throw new Error("No grounded venues matched that request. Try a nearby area or a broader mood.");
      setStops(suggested.map((stop, index) => ({ key: index + 1, ...stop })));
      setConciergeNote(typeof body.narration === "string" ? body.narration : "Grounded picks added. Change the order if you like.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The concierge could not sort this one.");
    } finally {
      setSorting(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!creatorName.trim() || !startTime || completeStops.length === 0) {
      setError("Add your name, a start time, and choose at least one venue from the list.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          creatorName,
          startTime: new Date(startTime).toISOString(),
          stops: completeStops.map(({ venueId, venueName }) => ({ venueId, venueName })),
        }),
      });
      const body = await response.json();
      if (!response.ok || !body?.plan?.plan?.id) {
        throw new Error(body?.error || "The plan could not be created.");
      }
      // lane_to_plan only counts creations with lane provenance (?src=…, set
      // by lane surfaces such as the W1 Tonight lane). window.location is read
      // at submit time — not via useSearchParams — so this client component
      // needs no Suspense boundary on the server-rendered /plan page. Without
      // a known src the event stays silent: honest zero > invented signal.
      const laneSource = laneSourceFromSearch(window.location.search);
      if (laneSource) {
        trackEvent("lane_to_plan", { source: laneSource, stops: completeStops.length });
      }
      if (body.memberToken) {
        sessionStorage.setItem(`pubmax-plan-member:${body.plan.plan.id}`, body.memberToken);
      }
      router.push(`/plan/${body.plan.plan.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The plan could not be created.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="planComposer" onSubmit={submit}>
      <section className="planComposer__templates" aria-labelledby="plan-templates-title">
        <h2 id="plan-templates-title">Start from an occasion</h2>
        <p className="planComposer__templatesLead">
          One tap fills the title and concierge prompt — still editable.
        </p>
        <div className="planComposer__templateRow" role="list">
          {PLAN_TEMPLATES.map((template: PlanTemplate) => (
            <button
              key={template.id}
              type="button"
              role="listitem"
              className="planComposer__template"
              title={template.blurb}
              onClick={() => {
                setTitle(template.title);
                setConciergeQuery(template.conciergeQuery);
                setConciergeNote(template.blurb);
              }}
            >
              {template.label}
            </button>
          ))}
        </div>
      </section>
      <section className="planComposer__concierge" aria-labelledby="plan-concierge-title">
        <div>
          <span className="planPage__eyebrow">PUBMAXXER concierge</span>
          <h2 id="plan-concierge-title">Tell it the mood. It picks the pubs.</h2>
        </div>
        <div className="planComposer__conciergeInput">
          <label className="planComposer__srOnly" htmlFor="plan-concierge-query">Describe the night</label>
          <input id="plan-concierge-query" value={conciergeQuery} onChange={(event) => setConciergeQuery(event.target.value)} placeholder="Quiet-ish near Bank, 4 of us, not pricey" maxLength={500} />
          <button type="button" onClick={sortWithConcierge} disabled={sorting || !conciergeQuery.trim()}>{sorting ? "Sorting…" : "Sort it"}</button>
        </div>
        {conciergeNote ? <p>{conciergeNote}</p> : null}
      </section>
      <div className="planComposer__field planComposer__field--wide">
        <label htmlFor="plan-title">Name the night</label>
        <input id="plan-title" maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} />
      </div>
      <div className="planComposer__field">
        <label htmlFor="plan-name">Your name</label>
        <input id="plan-name" autoComplete="name" maxLength={CREW_NAME_MAX} required value={creatorName} onChange={(event) => setCreatorName(event.target.value)} placeholder="Karan" />
      </div>
      <div className="planComposer__field">
        <label htmlFor="plan-time">First pint</label>
        <input id="plan-time" type="datetime-local" required value={startTime} onChange={(event) => setStartTime(event.target.value)} />
      </div>

      <fieldset className="planComposer__stops">
        <legend>The crawl</legend>
        {stops.map((stop, index) => (
          <div className="planComposer__stop" key={stop.key}>
            <span className="planComposer__number" aria-hidden="true">{index + 1}</span>
            <div>
              <label htmlFor={`venue-name-${stop.key}`}>Venue name</label>
              <input id={`venue-name-${stop.key}`} list="plan-venue-options" value={stop.venueName} onChange={(event) => chooseVenue(stop.key, event.target.value)} placeholder="Start typing a pub" />
            </div>
            {stops.length > 1 ? (
              <button className="planComposer__remove" type="button" onClick={() => setStops((current) => current.filter((item) => item.key !== stop.key))} aria-label={`Remove stop ${index + 1}`}>Remove</button>
            ) : null}
          </div>
        ))}
        <datalist id="plan-venue-options">
          {venues.map((venue) => <option key={venue.id} value={venue.name}>{venue.address}</option>)}
        </datalist>
        <button className="planComposer__add" type="button" onClick={() => setStops((current) => [...current, { key: Math.max(0, ...current.map((stop) => stop.key)) + 1, venueId: "", venueName: "" }])}>Add another stop</button>
      </fieldset>

      {error ? <p className="planComposer__error" role="alert">{error}</p> : null}
      <button className="planComposer__submit" type="submit" disabled={submitting}>{submitting ? "Locking it in…" : "Lock it in"}</button>
      <p className="planComposer__trust">Anyone with the link can see the plan. Joining only asks for a name.</p>
    </form>
  );
}
