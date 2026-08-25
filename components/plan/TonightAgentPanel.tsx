"use client";

import { offlineOrMessage } from "@/lib/apiErrorMessage";

// Tonight agent surface: one ask → grounded three-stop + WhatsApp invite draft.
// Reuses /api/plans/generate; never invents a route when scarcity answers 422.

import { FormEvent, useState } from "react";

import { transferGeneratedRouteToDraft } from "@/lib/mapRouteTransfer";
import { whatsappShareHref } from "@/lib/shareArtifacts";
import {
  buildTonightAgentGenerateBody,
  interpretTonightAgentGenerateBody,
  tonightStopPriceCaption,
  type TonightAgentResult,
} from "@/lib/tonightAgent";

import "./tonightAgent.css";

export default function TonightAgentPanel() {
  const [query, setQuery] = useState("Quiet in Clapham for 4, not pricey");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TonightAgentResult | null>(null);
  const [rawBody, setRawBody] = useState<unknown>(null);
  const [actionStatus, setActionStatus] = useState("");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setResult(null);
    setRawBody(null);
    setActionStatus("");
    try {
      const response = await fetch("/api/plans/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildTonightAgentGenerateBody(query)),
      });
      const body = await response.json().catch(() => null);
      setRawBody(body);
      setResult(
        interpretTonightAgentGenerateBody(response.ok, body, {
          title: trimmed.slice(0, 80),
        }),
      );
    } catch {
      setResult({
        ok: false,
        kind: "error",
        message: "PUBMAXX couldn't sort this one.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function copyDraft(text: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(text);
      setActionStatus("Invite draft copied.");
    } catch {
      setActionStatus(
        offlineOrMessage("Could not copy invite draft. Try again.")
      );
    }
  }

  function useStopsInComposer() {
    if (!rawBody || typeof window === "undefined") return;
    const wrote = transferGeneratedRouteToDraft(
      rawBody as Parameters<typeof transferGeneratedRouteToDraft>[0],
      window.localStorage,
      "plan-generated",
    );
    if (!wrote) {
      setActionStatus("Couldn't move those stops over just now.");
      return;
    }
    setActionStatus("Stops moved to your plan. Review and lock when you're ready.");
    window.location.assign("/plan#plan-composer");
  }

  return (
    <section className="tonightAgent" aria-labelledby="tonightAgentTitle">
      <h2 id="tonightAgentTitle" className="tonightAgentTitle">
        Tonight agent
      </h2>
      <p className="tonightAgentDek">
        Ask for a night. We only return stops we can stand behind, plus a draft
        WhatsApp invite. If the area can&rsquo;t meet your must-haves, we say so.
      </p>
      <form className="tonightAgentForm" onSubmit={onSubmit}>
        <label className="tonightAgentLabel" htmlFor="tonightAgentQuery">
          What do you want tonight?
        </label>
        <input
          id="tonightAgentQuery"
          className="tonightAgentInput"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          maxLength={500}
          autoComplete="off"
        />
        <button className="tonightAgentSubmit" type="submit" disabled={busy || !query.trim()}>
          {busy ? "Planning…" : "Plan and draft invite"}
        </button>
      </form>

      {result && !result.ok ? (
        <p
          className={
            result.kind === "scarcity" ? "tonightAgentScarcity" : "tonightAgentError"
          }
          role="status"
        >
          {result.message}
        </p>
      ) : null}

      {result?.ok ? (
        <div className="tonightAgentResult">
          <ol className="tonightAgentStops">
            {result.stops.map((stop) => {
              const caption = tonightStopPriceCaption(stop);
              return (
                <li key={stop.venueId}>
                  <span className="tonightAgentStopName">{stop.name}</span>
                  {typeof stop.pricePence === "number" ? (
                    <span className="tonightAgentStopPrice">
                      £{(stop.pricePence / 100).toFixed(2)}
                      {caption ? (
                        <span className="tonightAgentStopPriceCaption">
                          {caption}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="tonightAgentStopPrice tonightAgentStopPrice--unknown">
                      No price on record
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          <label className="tonightAgentLabel" htmlFor="tonightAgentDraft">
            Invite draft
          </label>
          <textarea
            id="tonightAgentDraft"
            className="tonightAgentDraft"
            readOnly
            value={result.inviteDraft}
            rows={3}
          />
          <div className="tonightAgentActions">
            <button
              type="button"
              className="tonightAgentAction"
              onClick={() => void copyDraft(result.inviteDraft)}
            >
              Copy draft
            </button>
            <a
              className="tonightAgentAction tonightAgentAction--wa"
              href={whatsappShareHref(result.inviteDraft)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Draft on WhatsApp
            </a>
            <button
              type="button"
              className="tonightAgentAction tonightAgentAction--primary"
              onClick={useStopsInComposer}
            >
              Use these stops
            </button>
          </div>
          <p className="tonightAgentNext">{result.nextStep}</p>
          {actionStatus ? (
            <p className="tonightAgentStatus" role="status">
              {actionStatus}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
