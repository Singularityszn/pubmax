"use client";

import { FormEvent, useCallback, useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";

import { CREW_NAME_MAX, type CrewMemberDTO, type CrewPresenceStatus } from "@/lib/crew";
import { subscribeToPlanCrew } from "@/lib/crewRealtime";
import { trackEvent } from "@/lib/analytics";
import { parsePlanCapabilitySnapshot, planCapabilityEvent, readPlanCapabilitySnapshot, writePlanCapability } from "@/lib/planSessionCapability";

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
  const tokenEvent = planCapabilityEvent(planId);
  const statusKey = `pubmax-plan-status:${planId}`;
  const statusEvent = `pubmax-plan-status-change:${planId}`;

  // Derived from sessionStorage so it survives a reload and stays lint-clean
  // (no setState-in-effect) — same external-store pattern as memberToken below.
  const myStatus = useSyncExternalStore<CrewPresenceStatus | "">(
    (onChange) => {
      window.addEventListener("storage", onChange);
      window.addEventListener(statusEvent, onChange);
      return () => {
        window.removeEventListener("storage", onChange);
        window.removeEventListener(statusEvent, onChange);
      };
    },
    () => {
      try {
        const stored = sessionStorage.getItem(statusKey);
        return stored && stored in STATUS_LABELS ? (stored as CrewPresenceStatus) : "";
      } catch {
        return "";
      }
    },
    () => "",
  );

  const rememberStatus = useCallback((status: CrewPresenceStatus | "") => {
    try {
      if (status) sessionStorage.setItem(statusKey, status);
      else sessionStorage.removeItem(statusKey);
    } catch {
      // sessionStorage can be unavailable (private mode); presence still works in-session.
    }
    window.dispatchEvent(new Event(statusEvent));
  }, [statusKey, statusEvent]);
  const capabilitySnapshot = useSyncExternalStore(
    (onChange) => {
      window.addEventListener("storage", onChange);
      window.addEventListener(tokenEvent, onChange);
      return () => {
        window.removeEventListener("storage", onChange);
        window.removeEventListener(tokenEvent, onChange);
      };
    },
    () => {
      return readPlanCapabilitySnapshot(planId);
    },
    () => "|0",
  );
  const { token: memberToken, collaborationAuthorized } = parsePlanCapabilitySnapshot(capabilitySnapshot);

  useEffect(() => {
    if (!memberToken) return;
    const inviteToken = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("invite");
    if (!inviteToken) return;
    if (collaborationAuthorized) {
      history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      return;
    }
    try {
      if (sessionStorage.getItem(`pubmaxx:plan-creator-token:v1:${planId}`) === memberToken) {
        writePlanCapability(planId, { token: memberToken, collaborationAuthorized: true });
        history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
        return;
      }
    } catch {
      // Configured storage may be unavailable; the server still rejects host upgrades.
    }
    const controller = new AbortController();
    fetch(`/api/plans/${planId}/invites/redeem`, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${memberToken}` },
      body: JSON.stringify({ inviteToken }),
    })
      .then(async (response) => ({ response, body: await response.json().catch(() => null) }))
      .then(({ response, body }) => {
        if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Could not unlock crew decisions.");
        writePlanCapability(planId, { token: memberToken, collaborationAuthorized: true });
        history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Could not unlock crew decisions.");
      });
    return () => controller.abort();
  }, [collaborationAuthorized, memberToken, planId]);

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
      const inviteToken = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("invite") ?? undefined;
      const response = await fetch(`/api/plans/${planId}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, inviteToken }),
      });
      const body = await response.json();
      if (!response.ok || !body?.memberToken) throw new Error(body?.error || "Could not join this plan.");
      writePlanCapability(planId, { token: body.memberToken, collaborationAuthorized: body.collaborationAuthorized === true });
      if (inviteToken) history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      rememberStatus("in");
      const nextCrew = body.plan?.crew ?? crew;
      setCrew(nextCrew);
      trackEvent("crew_committed", {
        source: "shared-plan",
        participants: Array.isArray(nextCrew) ? nextCrew.length : 1,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not join this plan.");
    } finally {
      setPending(false);
    }
  }

  async function updatePresence(status: CrewPresenceStatus) {
    if (!memberToken || status === myStatus) return;
    const previous = myStatus;
    rememberStatus(status); // optimistic: reflect the tap on the same frame (Apple: respond on press)
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
      rememberStatus(previous); // roll back the optimistic state on failure
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

      {!memberToken ? (
        <form className="planCrew__join" onSubmit={join}>
          <label htmlFor="join-name">No account. Just your name.</label>
          <div><input id="join-name" autoComplete="name" maxLength={CREW_NAME_MAX} value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" required /><button type="submit" disabled={pending}>I&rsquo;m in</button></div>
        </form>
      ) : (
        <div className="planCrew__presence" role="group" aria-label="Update your status">
          {(Object.keys(STATUS_LABELS) as CrewPresenceStatus[]).map((status) => (
            <button
              type="button"
              key={status}
              disabled={pending}
              aria-pressed={myStatus === status}
              data-active={myStatus === status ? "" : undefined}
              onClick={() => updatePresence(status)}
            >
              {STATUS_LABELS[status]}
            </button>
          ))}
        </div>
      )}

      {crew.length ? (
        <ul className="planCrew__list">
          {crew.map((member, index) => (
            <li key={member.id} style={{ "--i": index } as CSSProperties}>
              <span>{member.name}</span>
              <small data-status={member.status}>{STATUS_LABELS[member.status]}</small>
            </li>
          ))}
        </ul>
      ) : <p className="planCrew__empty">Be the first name on the night.</p>}
      {error ? <p className="planComposer__error" role="alert">{error}</p> : null}
    </section>
  );
}
