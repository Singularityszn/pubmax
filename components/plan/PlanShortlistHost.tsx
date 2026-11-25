"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import Screen from "@/components/ui/screen";
import { trackEvent } from "@/lib/analytics";
import { errorMessageFrom, offlineOrMessage, readApiJson } from "@/lib/apiErrorMessage";
import { formatGbp } from "@/lib/formatGbp";
import { planInviteSharePath } from "@/lib/planCrewInviteUrl";
import { defaultLondonStartInput, londonDateTimeInputToIso } from "@/lib/planIntake";
import type { ShortlistView } from "@/lib/planShortlist";
import { whatsappShareHref } from "@/lib/shareArtifacts";
import { ConfirmedShortlist } from "./PlanShortlistCard";

type HostShortlist = { shortlist: ShortlistView; token: string; budgetLimitPence: number | null; expired: boolean };

export default function PlanShortlistHost({ planId }: { planId: string }) {
  const [host, setHost] = useState<HostShortlist | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [origin, setOrigin] = useState("");
  const endpoint = `/api/plans/${planId}/shortlist`;

  const load = useCallback((signal?: AbortSignal) => {
    void fetch(endpoint, { signal }).then(async (response) => {
      const body = await readApiJson(response) as HostShortlist | null;
      if (signal?.aborted) return;
      if (!response.ok || !body?.shortlist) throw new Error(errorMessageFrom(body, "Could not load the shortlist."));
      setHost(body);
      setOrigin(window.location.origin);
      setMessage("");
    }).catch((error: unknown) => {
      if (!signal?.aborted) setMessage(offlineOrMessage(error instanceof Error ? error.message : "Could not load the shortlist."));
    });
  }, [endpoint]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const path = planInviteSharePath(host?.token);
  const url = origin && path ? new URL(path, origin).href : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      trackEvent("plan_shortlist_shared", { channel: "copy" });
      setMessage("Invite link copied");
    } catch {
      setMessage("Select the invite link to copy it.");
    }
  }

  async function rotate() {
    if (!host || pending || !window.confirm("Make a new invite link? The old link will stop working.")) return;
    setPending(true);
    try {
      const response = await fetch(`/api/plans/${planId}/invite-rotate`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      });
      const result = await readApiJson(response) as { inviteToken?: string } | null;
      if (!response.ok || !result?.inviteToken) throw new Error(errorMessageFrom(result, "Could not make a new invite link."));
      setHost({ ...host, token: result.inviteToken });
      setMessage("New invite link ready");
    } catch (error) {
      setMessage(offlineOrMessage(error instanceof Error ? error.message : "Could not make a new invite link."));
    } finally {
      setPending(false);
    }
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!host || pending) return;
    const data = new FormData(event.currentTarget);
    const startTime = londonDateTimeInputToIso(String(data.get("start")), new Date());
    if (!startTime) {
      setMessage("Choose a valid future London time.");
      return;
    }
    setPending(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ venueId: data.get("venueId"), startTime }),
      });
      const result = await readApiJson(response) as { shortlist?: ShortlistView; changed?: boolean } | null;
      if (!response.ok || !result?.shortlist) throw new Error(errorMessageFrom(result, "Could not confirm the pub and time."));
      setHost({ ...host, shortlist: result.shortlist });
      setMessage("Pub and time confirmed");
      if (result.changed) trackEvent("plan_shortlist_confirmed");
    } catch (error) {
      setMessage(offlineOrMessage(error instanceof Error ? error.message : "Could not confirm the pub and time."));
    } finally {
      setPending(false);
    }
  }

  const view = host?.shortlist;
  const expired = host?.expired;
  return (
    <Screen title="Group night" lede="Share the shortlist, then confirm the pub and time.">
      <div className="planShortlist">
        {view && !expired && url ? (
          <div className="planShortlist__options">
            <div className="planShortlist__actions">
              <Button asChild>
                <a href={whatsappShareHref(url)} target="_blank" rel="noopener noreferrer"
                  onClick={() => trackEvent("plan_shortlist_shared", { channel: "whatsapp" })}>Send on WhatsApp</a>
              </Button>
              <Button type="button" variant="secondary" onClick={() => void copy()}>Copy invite link</Button>
            </div>
            <label>Invite link<input type="url" readOnly value={url} onFocus={(event) => event.currentTarget.select()} /></label>
            <Button type="button" variant="secondary" disabled={pending} onClick={() => void rotate()}>Make new invite link</Button>
          </div>
        ) : null}
        {expired ? <p>This invite link has expired.</p> : null}
        {view?.confirmed ? <ConfirmedShortlist view={view} /> : null}
        {host?.budgetLimitPence != null ? (
          <p>Whole outing budget per person {formatGbp(host.budgetLimitPence / 100)}. Total cost unchecked.</p>
        ) : null}
        {view && !view.confirmed && !expired ? (
          <form onSubmit={confirm} className="planShortlist__fields">
            <Button type="button" variant="secondary" disabled={pending} onClick={() => void load()}>Refresh votes</Button>
            <label>Pub to confirm
              <select name="venueId" required defaultValue="">
                <option value="" disabled>Choose a pub</option>
                {view.options.map((option) => <option key={option.venueId} value={option.venueId}>{option.venueName}</option>)}
              </select>
            </label>
            <ul aria-label="Vote totals">
              {view.options.map((option) => <li key={option.venueId}>{option.venueName} · {view.counts[option.venueId]}</li>)}
            </ul>
            <label>Meet at (London time)<input name="start" type="datetime-local" defaultValue={defaultLondonStartInput()} required /></label>
            <Button type="submit" disabled={pending}>Confirm pub and time</Button>
          </form>
        ) : null}
        <p role="status">{message || (!view ? "Loading shortlist…" : "")}</p>
        {message && !view ? <Button type="button" onClick={() => void load()}>Try again</Button> : null}
      </div>
    </Screen>
  );
}
