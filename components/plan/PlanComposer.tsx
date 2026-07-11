"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

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
      <div className="planComposer__field planComposer__field--wide">
        <label htmlFor="plan-title">Name the night</label>
        <input id="plan-title" maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} />
      </div>
      <div className="planComposer__field">
        <label htmlFor="plan-name">Your name</label>
        <input id="plan-name" autoComplete="name" maxLength={60} required value={creatorName} onChange={(event) => setCreatorName(event.target.value)} placeholder="Karan" />
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
      <button className="planComposer__submit" type="submit" disabled={submitting}>{submitting ? "Sorting…" : "Make it a Plan"}</button>
      <p className="planComposer__trust">Anyone with the link can see the plan. Joining only asks for a name.</p>
    </form>
  );
}
