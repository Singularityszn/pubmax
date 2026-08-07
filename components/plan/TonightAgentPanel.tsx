"use client";

// Tonight agent surface: one ask → grounded three-stop + WhatsApp invite draft.
// Reuses /api/plans/generate; never invents a route when scarcity answers 422.

import { FormEvent, useState } from "react";

import {
  interpretTonightAgentGenerateBody,
  type TonightAgentResult,
} from "@/lib/tonightAgent";

import "./tonightAgent.css";

export default function TonightAgentPanel() {
  const [query, setQuery] = useState("Quiet in Clapham for 4, not pricey");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TonightAgentResult | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/api/plans/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
      });
      const body = await response.json().catch(() => null);
      setResult(
        interpretTonightAgentGenerateBody(response.ok, body, {
          title: trimmed.slice(0, 80),
        }),
      );
    } catch {
      setResult({
        ok: false,
        kind: "error",
        message: "PUBMAXX could not sort this one.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="tonightAgent" aria-labelledby="tonightAgentTitle">
      <h2 id="tonightAgentTitle" className="tonightAgentTitle">
        Tonight agent
      </h2>
      <p className="tonightAgentDek">
        Ask for a night. We only return stops we can stand behind, plus a draft
        WhatsApp invite. If the area cannot meet your must-haves, we say so.
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
            {result.stops.map((stop) => (
              <li key={stop.venueId}>
                <span className="tonightAgentStopName">{stop.name}</span>
                {typeof stop.priceGbp === "number" ? (
                  <span className="tonightAgentStopPrice">
                    £{stop.priceGbp.toFixed(2)}
                  </span>
                ) : (
                  <span className="tonightAgentStopPrice tonightAgentStopPrice--unknown">
                    No price on record
                  </span>
                )}
              </li>
            ))}
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
          <p className="tonightAgentNext">{result.nextStep}</p>
        </div>
      ) : null}
    </section>
  );
}
