"use client";

import { useCallback, useEffect, useState } from "react";

import { ASK_PLAN_DRAFT_STORAGE_KEY } from "@/lib/ask/types";
import { authedFetch } from "@/lib/authedFetch";
import { categoryLabel } from "@/lib/drinks";
import type { SocialCrewListItemDTO } from "@/lib/socialCrew";
import { parseCrewListPage } from "@/lib/socialCrewsUi";
import {
  wantedPendingLabel,
  type WantedDTO,
} from "@/lib/wanted";
import { venueMapUrl } from "@/lib/venueMapUrl";

import WantedCapture from "./WantedCapture";
import "./wanted.css";

function mapUrlFor(wanted: WantedDTO): string | null {
  if (!wanted.venueId) return null;
  try {
    return venueMapUrl(wanted.venueId);
  } catch {
    return `/map?sel=${encodeURIComponent(wanted.venueId)}`;
  }
}

type CrewOption = Pick<SocialCrewListItemDTO, "crewId" | "title">;

function visibilityOptions(
  wanted: WantedDTO,
  crews: readonly CrewOption[],
): Array<{ value: string; label: string }> {
  const options = [
    { value: "private", label: "Only you" },
    { value: "mutuals", label: "Your mutuals" },
    ...crews.map((crew) => ({
      value: `crew:${crew.crewId}`,
      label: `Crew: ${crew.title}`,
    })),
  ];
  if (!options.some((option) => option.value === wanted.visibility)) {
    options.push({ value: wanted.visibility, label: "Current Crew" });
  }
  return options;
}

export default function WantedList(): React.JSX.Element {
  const [wanteds, setWanteds] = useState<WantedDTO[]>([]);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "sign_in" | "error">(
    "loading",
  );
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [softPlanId, setSoftPlanId] = useState<string | null>(null);
  const [crews, setCrews] = useState<CrewOption[]>([]);
  const [sharingId, setSharingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await authedFetch("/api/wanted");
      const body = (await res.json()) as {
        wanteds?: WantedDTO[];
        status?: string;
        error?: string;
      };
      if (res.status === 401 || body.status === "sign_in_required") {
        setLoadStatus("sign_in");
        setWanteds([]);
        return;
      }
      if (!res.ok) {
        setLoadStatus("error");
        return;
      }
      setWanteds(Array.isArray(body.wanteds) ? body.wanteds : []);
      setLoadStatus("ready");
    } catch {
      setLoadStatus("error");
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => refresh());
  }, [refresh]);

  useEffect(() => {
    const controller = new AbortController();
    void authedFetch("/api/social/crews?limit=50", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return parseCrewListPage(await response.json());
      })
      .then((page) => {
        if (!page) return;
        setCrews(page.items.map(({ crewId, title }) => ({ crewId, title })));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const open = wanteds.filter((row) => row.status === "open");
  const fulfilled = wanteds.filter((row) => row.status === "fulfilled");

  async function addToSoftPlan(wanted: WantedDTO) {
    if (!wanted.venueId || softPlanId) return;
    setSoftPlanId(wanted.id);
    try {
      const response = await authedFetch("/api/wanted", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "soft-plan", id: wanted.id }),
      });
      const body = (await response.json()) as { softPlan?: { query?: string; venueId?: string } };
      if (!response.ok || !body.softPlan?.query || body.softPlan.venueId !== wanted.venueId) return;
      sessionStorage.setItem(ASK_PLAN_DRAFT_STORAGE_KEY, JSON.stringify({
        query: body.softPlan.query,
        stopIds: [wanted.venueId],
        stopNames: [wanted.venueName],
        createdAt: new Date().toISOString(),
      }));
      window.location.assign("/plan");
    } catch {
      // The list remains usable when the optional Plan handoff is unavailable.
    } finally {
      setSoftPlanId(null);
    }
  }

  async function changeVisibility(wanted: WantedDTO, visibility: string) {
    if (visibility === wanted.visibility || sharingId) return;
    setSharingId(wanted.id);
    try {
      const response = await authedFetch("/api/wanted", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "visibility", id: wanted.id, visibility }),
      });
      const body = (await response.json()) as { wanted?: WantedDTO; error?: string };
      if (!response.ok || !body.wanted) {
        setStatusNote(body.error ?? "Could not change who can see that Wanted place.");
        return;
      }
      setWanteds((current) =>
        current.map((row) => (row.id === body.wanted?.id ? body.wanted : row)),
      );
    } catch {
      setStatusNote("Could not change who can see that Wanted place.");
    } finally {
      setSharingId(null);
    }
  }

  return (
    <section className="wantedPanel" id="wanted" aria-labelledby="wanted-heading">
      <h2 id="wanted-heading" className="wantedPanel__title">
        Wanted
      </h2>
      <p className="wantedPanel__lede">
        Paste a pub name or a link you saved elsewhere. It becomes a place you can plan
        around. Supported links use public provider metadata; arbitrary links stay provenance.
      </p>

      {loadStatus === "sign_in" ? (
        <p className="wantedPanel__empty">Sign in to keep a Wanted list.</p>
      ) : (
        <WantedCapture
          crews={crews}
          onSaved={(wanted) => {
            setWanteds((prev) => [wanted, ...prev.filter((row) => row.id !== wanted.id)]);
            setLoadStatus("ready");
          }}
        />
      )}

      {statusNote ? (
        <p className="wantedFulfilNote" role="status">
          {statusNote}
        </p>
      ) : null}

      {loadStatus === "loading" ? (
        <p className="wantedPanel__empty">Loading your Wanted list…</p>
      ) : null}
      {loadStatus === "error" ? (
        <p className="wantedPanel__empty">Could not load Wanted places right now.</p>
      ) : null}

      {loadStatus === "ready" && open.length === 0 ? (
        <p className="wantedPanel__empty">No open Wanted places yet.</p>
      ) : null}

      {open.length > 0 ? (
        <ul className="wantedList" aria-label="Open Wanted places">
          {open.map((wanted) => {
            const href = mapUrlFor(wanted);
            const title =
              wanted.venueKind === "pending"
                ? wantedPendingLabel(wanted.rawPaste)
                : wanted.venueName;
            return (
              <li key={wanted.id} className="wantedRow">
                <div>
                  <p className="wantedRow__name">{title}</p>
                  <p className="wantedRow__meta">
                    {wanted.venueKind === "uk_base"
                      ? "UK pub · mark only, no invented pint price"
                      : wanted.venueKind === "pending"
                        ? "Still matching"
                        : "On the priced map"}
                    {wanted.sourceUrl ? " · link saved as provenance" : ""}
                    {wanted.drinkInterest ? ` · ${categoryLabel(wanted.drinkInterest)}` : ""}
                    {wanted.visibility === "mutuals" ? " · mutuals" : wanted.visibility.startsWith("crew:") ? " · Crew" : ""}
                    {wanted.note ? ` · ${wanted.note}` : ""}
                  </p>
                </div>
                <div className="wantedRow__actions">
                  {crews.length > 0 ? (
                    <select
                      className="wantedRow__share"
                      aria-label={`Share ${title} with`}
                      value={wanted.visibility}
                      disabled={sharingId !== null}
                      onChange={(event) =>
                        void changeVisibility(wanted, event.target.value)
                      }
                    >
                      {visibilityOptions(wanted, crews).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  {href ? <a className="wantedRow__map" href={href}>Open map</a> : null}
                  {href ? (
                    <button
                      type="button"
                      className="wantedRow__map"
                      onClick={() => void addToSoftPlan(wanted)}
                      disabled={softPlanId !== null}
                    >
                      {softPlanId === wanted.id ? "Opening…" : "Soft Plan"}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {fulfilled.length > 0 ? (
        <ul className="wantedList" aria-label="Fulfilled Wanted places">
          {fulfilled.slice(0, 5).map((wanted) => (
            <li key={wanted.id} className="wantedRow">
              <div>
                <p className="wantedRow__name">{wanted.venueName || wantedPendingLabel(wanted.rawPaste)}</p>
                <p className="wantedRow__meta">Done</p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Keep setFulfilNote reachable for presence celebrate handoff via custom event. */}
       <WantedFulfilListener onNote={setStatusNote} onRefresh={() => void refresh()} />
    </section>
  );
}

function WantedFulfilListener({
  onNote,
  onRefresh,
}: {
  onNote: (note: string | null) => void;
  onRefresh: () => void;
}): null {
  useEffect(() => {
    function onEvent(event: Event) {
      const detail = (event as CustomEvent<{ note?: string }>).detail;
      if (detail?.note) onNote(detail.note);
      onRefresh();
    }
    window.addEventListener("pubmax:wanted-fulfilled", onEvent);
    return () => window.removeEventListener("pubmax:wanted-fulfilled", onEvent);
  }, [onNote, onRefresh]);
  return null;
}
