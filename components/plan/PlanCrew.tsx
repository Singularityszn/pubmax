"use client";

import { FormEvent, useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { CREW_NAME_MAX, type CrewMemberDTO, type CrewPresenceStatus } from "@/lib/crew";
import { subscribeToPlanCrew } from "@/lib/crewRealtime";

const STATUS_LABELS: Record<CrewPresenceStatus, string> = {
  in: "In",
  on_the_way: "On the way",
  here: "Here",
  running_late: "Running late",
  start_without_me: "Start without me",
};

export default function PlanCrew({ planId, initialCrew }: { planId: string; initialCrew: CrewMemberDTO[] }) {
  const [crew, setCrew] = useState(initialCrew);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const tokenEvent = `pubmax-plan-member-change:${planId}`;
  const memberToken = useSyncExternalStore(
    (onChange) => {
      window.addEventListener("storage", onChange);
      window.addEventListener(tokenEvent, onChange);
      return () => {
        window.removeEventListener("storage", onChange);
        window.removeEventListener(tokenEvent, onChange);
      };
    },
    () => sessionStorage.getItem(`pubmax-plan-member:${planId}`) ?? "",
    () => "",
  );

  const refetchCrew = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    const response = await fetch(`/api/plans/${planId}`, { cache: "no-store" }).catch(() => null);
    if (!response?.ok) return;
    const body = await response.json();
    if (Array.isArray(body?.crew)) setCrew(body.crew);
  }, [planId]);

  useEffect(() => {
    return subscribeToPlanCrew(planId, refetchCrew, { poll: refetchCrew });
  }, [planId, refetchCrew]);

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/plans/${planId}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = await response.json();
      if (!response.ok || !body?.memberToken) throw new Error(body?.error || "Could not join this plan.");
      sessionStorage.setItem(`pubmax-plan-member:${planId}`, body.memberToken);
      window.dispatchEvent(new Event(tokenEvent));
      setCrew(body.plan?.crew ?? crew);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not join this plan.");
    } finally {
      setPending(false);
    }
  }

  async function updatePresence(status: CrewPresenceStatus) {
    if (!memberToken) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/plans/${planId}/presence`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memberToken, status }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Could not update your status.");
      setCrew(body.crew ?? crew);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update your status.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="planCrew" aria-labelledby="plan-crew-title">
      <div className="planCrew__heading">
        <div><p className="planPage__eyebrow">The crew</p><h2 id="plan-crew-title">Who&rsquo;s in</h2></div>
        <span>{crew.length}</span>
      </div>
      {crew.length ? (
        <ul className="planCrew__list">
          {crew.map((member) => <li key={member.id}><span>{member.name}</span><small>{STATUS_LABELS[member.status]}</small></li>)}
        </ul>
      ) : <p className="planCrew__empty">Be the first name on the night.</p>}

      {!memberToken ? (
        <form className="planCrew__join" onSubmit={join}>
          <label htmlFor="join-name">No account. Just your name.</label>
          <div><input id="join-name" autoComplete="name" maxLength={CREW_NAME_MAX} value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" required /><button type="submit" disabled={pending}>I&rsquo;m in</button></div>
        </form>
      ) : (
        <div className="planCrew__presence" aria-label="Update your status">
          {(Object.keys(STATUS_LABELS) as CrewPresenceStatus[]).map((status) => <button type="button" disabled={pending} key={status} onClick={() => updatePresence(status)}>{STATUS_LABELS[status]}</button>)}
        </div>
      )}
      {error ? <p className="planComposer__error" role="alert">{error}</p> : null}
    </section>
  );
}
