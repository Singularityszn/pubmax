"use client";

// F3 — concierge as map home. The grounded Landlord concierge, surfaced as a
// first-class ask affordance on the map (not buried in the plan composer). A
// collapsed pill sits in the bottom map-home lane (above the W1 Tonight lane,
// which it never overlaps — see mapConciergeAsk.css sibling rule). Tapping opens
// an input; answers render as map-linked cards where a tap flies the camera to
// the venue and opens its sheet (onSelectVenue → the same ?sel= deep-link path).
//
// No new backend and no paid-model additions: this composes the EXISTING
// /api/concierge route, which keeps its grounded / honest-refusal behaviour
// (venue ranking OR a What's-On answer, each carrying provenance, refusing
// rather than inventing). This component is pure presentation over that route.

import { useCallback, useRef, useState } from "react";
import { MessageCircleQuestion, MapPin, Sparkles, X } from "lucide-react";

import { trackEvent } from "@/lib/analytics";

import "./mapConciergeAsk.css";

// A normalised, map-linkable answer card — from either concierge response shape
// (venue ranking or a What's-On listing). `venueId` empty means "not tappable".
type AskCard = {
  key: string;
  venueId: string;
  title: string;
  place: string;
  note: string;
  price: number | null;
};

const EXAMPLE_PROMPTS = [
  "Quiet-ish near Bank, 4 of us",
  "Quiz tonight in Soho",
  "Cheap pint, big group",
] as const;

type AskState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "answered"; message: string; cards: AskCard[] }
  | { status: "error"; message: string };

type MapConciergeAskProps = {
  cityId: string;
  onSelectVenue: (venueId: string) => void;
};

export default function MapConciergeAsk({
  cityId,
  onSelectVenue,
}: MapConciergeAskProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<AskState>({ status: "idle" });
  const inputRef = useRef<HTMLInputElement | null>(null);

  const expand = useCallback(() => {
    setOpen(true);
    // Focus after the panel paints so the caret lands in the input.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const collapse = useCallback(() => {
    setOpen(false);
  }, []);

  const ask = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      setState({ status: "loading" });
      trackEvent("concierge_ask");
      try {
        const response = await fetch("/api/concierge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: text, cityId, limit: 4 }),
        });
        const body = await response.json();
        if (!response.ok) {
          throw new Error(
            typeof body?.error === "string"
              ? body.error
              : "The landlord couldn't sort that one just now.",
          );
        }
        setState(answerFromBody(body));
      } catch (caught) {
        setState({
          status: "error",
          message:
            caught instanceof Error
              ? caught.message
              : "The landlord couldn't sort that one just now.",
        });
      }
    },
    [cityId],
  );

  const onSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void ask(query);
    },
    [ask, query],
  );

  const pickCard = useCallback(
    (card: AskCard) => {
      if (!card.venueId) return;
      trackEvent("concierge_result_tap");
      onSelectVenue(card.venueId);
      // Collapse so the venue sheet the fly-to opens is unobstructed.
      setOpen(false);
    },
    [onSelectVenue],
  );

  if (!open) {
    return (
      <div className="mapConciergeAsk mapConciergeAsk--collapsed">
        <button
          type="button"
          className="mapConciergeAskPill pressable"
          onClick={expand}
          aria-expanded={false}
        >
          <Sparkles size={16} aria-hidden="true" />
          <span>Ask the landlord</span>
        </button>
      </div>
    );
  }

  return (
    <div className="mapConciergeAsk mapConciergeAsk--open">
      <section
        className="mapConciergeAskPanel"
        role="dialog"
        aria-label="Ask the landlord"
      >
        <header className="mapConciergeAskHead">
          <span className="mapConciergeAskEyebrow">
            <MessageCircleQuestion size={14} aria-hidden="true" />
            Ask the landlord
          </span>
          <button
            type="button"
            className="mapConciergeAskClose pressable"
            onClick={collapse}
            aria-label="Close ask"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <form className="mapConciergeAskForm" onSubmit={onSubmit}>
          <label className="mapConciergeAskSr" htmlFor="map-concierge-query">
            Describe the night
          </label>
          <input
            id="map-concierge-query"
            ref={inputRef}
            className="mapConciergeAskInput"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Quiet-ish near Bank, not pricey…"
            maxLength={500}
            enterKeyHint="search"
          />
          <button
            type="submit"
            className="mapConciergeAskGo pressable"
            disabled={state.status === "loading" || !query.trim()}
          >
            {state.status === "loading" ? "Asking…" : "Ask"}
          </button>
        </form>

        {state.status === "idle" ? (
          <div className="mapConciergeAskExamples" aria-label="Example asks">
            {EXAMPLE_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="mapConciergeAskChip pressable"
                onClick={() => {
                  setQuery(prompt);
                  void ask(prompt);
                }}
              >
                {prompt}
              </button>
            ))}
          </div>
        ) : null}

        {state.status === "error" ? (
          <p className="mapConciergeAskMsg mapConciergeAskMsg--error" role="alert">
            {state.message}
          </p>
        ) : null}

        {state.status === "answered" ? (
          <div className="mapConciergeAskAnswer">
            <p className="mapConciergeAskMsg">{state.message}</p>
            {state.cards.length > 0 ? (
              <ul className="mapConciergeAskList">
                {state.cards.map((card) => {
                  const tappable = Boolean(card.venueId);
                  const body = (
                    <>
                      <div className="mapConciergeAskCardTop">
                        <p className="mapConciergeAskCardTitle">{card.title}</p>
                        {typeof card.price === "number" ? (
                          <span className="mapConciergeAskCardPrice">
                            £{card.price.toFixed(2)}
                          </span>
                        ) : null}
                      </div>
                      <p className="mapConciergeAskCardPlace">
                        <MapPin size={12} aria-hidden="true" />
                        <span>{card.place}</span>
                      </p>
                      {card.note ? (
                        <p className="mapConciergeAskCardNote">{card.note}</p>
                      ) : null}
                    </>
                  );
                  return (
                    <li key={card.key} className="mapConciergeAskCard">
                      {tappable ? (
                        <button
                          type="button"
                          className="mapConciergeAskCardTap pressable"
                          onClick={() => pickCard(card)}
                        >
                          {body}
                          <span className="mapConciergeAskCardCta" aria-hidden="true">
                            Show on map
                          </span>
                        </button>
                      ) : (
                        <div className="mapConciergeAskCardTap mapConciergeAskCardTap--static">
                          {body}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

// Normalise either concierge response shape into map-linkable cards. Both paths
// stay grounded: venue ranking returns real venues with reasons; the What's-On
// path returns verified listings with provenance. We never fabricate a message —
// the route always supplies its own honest copy (including refusals).
function answerFromBody(body: unknown): AskState {
  const record =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  // What's-On answer (grounded listings). Carries its own honest message.
  if (record.mode === "whats-on") {
    const listings = Array.isArray(record.listings) ? record.listings : [];
    const cards: AskCard[] = listings.map((raw, index) => {
      const item = (raw ?? {}) as Record<string, unknown>;
      return {
        key: str(item.id) || `wo-${index}`,
        venueId: str(item.venueId),
        title: str(item.title) || "Listing",
        place: str(item.venue),
        note: str(item.detail),
        price: num(item.priceGbp),
      };
    });
    return {
      status: "answered",
      message: str(record.message) || "Here's what I found.",
      cards,
    };
  }

  // Venue-ranking answer. `message` is only present on the degraded/empty path.
  const venues = Array.isArray(record.venues) ? record.venues : [];
  const cards: AskCard[] = venues.map((raw, index) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const reasons = Array.isArray(item.reasons)
      ? (item.reasons.filter((r) => typeof r === "string") as string[])
      : [];
    return {
      key: str(item.id) || `v-${index}`,
      venueId: str(item.id),
      title: str(item.name) || "Pub",
      place: str(item.area),
      note: reasons[0] ?? "",
      price: num(item.cheapestPrice),
    };
  });

  const message =
    str(record.message) ||
    (cards.length > 0
      ? `${cards.length} grounded ${cards.length === 1 ? "pick" : "picks"} — tap to see it on the map.`
      : "No grounded matches for that — try a nearby area or a broader mood.");

  return { status: "answered", message, cards };
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
