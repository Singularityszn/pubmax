"use client";

// Pub Pal chat surface (/pal/chat) — a chat SKIN over the EXISTING grounded
// concierge engine. The user asks in natural language; the engine parses intent
// deterministically and ranks over OUR rows (or looks up a verified What's-On
// row); the answer cards ARE the facts, each keeping its provenance label.
//
// No new backend and no paid-model additions: this composes the existing
// /api/concierge route (durably rate-limited, fails closed on paid spend), which
// keeps its grounded / honest-refusal behaviour. No model narration is
// requested (the paid seam stays OFF); no web-search grounding is called (that
// seam is a stub, OFF — see lib/palChat PAL_WEB_GROUNDING). This component is
// pure presentation over the pure ask session in lib/palChatClient.
//
// Multi-turn memory is OUT: the visible transcript is ephemeral session display
// only. Every ask forwards ONLY the current query, so the engine has no
// conversational memory, and nothing is persisted.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, MapPin, Sparkles } from "lucide-react";

import { trackEvent } from "@/lib/analytics";
import { DEFAULT_CITY_ID } from "@/lib/cities";
import { formatPalWhen, type PalAnswer, type PalCard } from "@/lib/palChat";
import { createPalChatSession } from "@/lib/palChatClient";

import "./palChat.css";

const EXAMPLE_PROMPTS = [
  "Quiet-ish near Bank, 4 of us",
  "Quiz tonight in Soho",
  "Cheap pint, big group",
  "Beer garden near the river",
] as const;

type Entry =
  | { kind: "user"; id: string; text: string }
  | { kind: "answer"; id: string; answer: PalAnswer }
  | { kind: "error"; id: string; message: string };

function VenueLink({
  card,
  onOpen,
  children,
}: {
  card: PalCard;
  onOpen: () => void;
  children: React.ReactNode;
}) {
  // A card is only tappable when it deep-links to a real venue on the map. The
  // static variant still renders every fact and its provenance.
  if (!card.venueId) {
    return <div className="palChatCardBody palChatCardBody--static">{children}</div>;
  }
  return (
    <Link
      className="palChatCardBody palChatCardBody--link"
      href={`/map?sel=${encodeURIComponent(card.venueId)}`}
      onClick={onOpen}
    >
      {children}
    </Link>
  );
}

function ProvChip({ card }: { card: PalCard }) {
  // Provenance is non-negotiable and kept on every card. A What's-On row carries
  // an attributable link; a first-party directory row reads "On record".
  const { provenance } = card;
  const label = provenance.label;
  if (provenance.url) {
    return (
      <a
        className="palChatProv palChatProv--link"
        href={provenance.url}
        target="_blank"
        rel="noreferrer noopener"
        // Stop the outer venue link from also firing.
        onClick={(event) => event.stopPropagation()}
      >
        {label}
      </a>
    );
  }
  return <span className="palChatProv">{label}</span>;
}

function AnswerCard({ card, onOpen }: { card: PalCard; onOpen: () => void }) {
  const when = card.when ? formatPalWhen(card.when) : "";
  return (
    <li className="palChatCard">
      <VenueLink card={card} onOpen={onOpen}>
        <div className="palChatCardTop">
          <p className="palChatCardTitle">{card.title}</p>
          {typeof card.price === "number" ? (
            <span className="palChatCardPrice">£{card.price.toFixed(2)}</span>
          ) : null}
        </div>
        {card.place ? (
          <p className="palChatCardPlace">
            <MapPin size={12} aria-hidden="true" />
            <span>{card.place}</span>
          </p>
        ) : null}
        {when ? <p className="palChatCardWhen">{when}</p> : null}
        {card.note ? <p className="palChatCardNote">{card.note}</p> : null}
        <div className="palChatCardMeta">
          <ProvChip card={card} />
          {card.confidence ? (
            <span className="palChatConfidence">{card.confidence}</span>
          ) : null}
          {card.venueId ? (
            <span className="palChatCardCta" aria-hidden="true">
              Show on map
            </span>
          ) : null}
        </div>
      </VenueLink>
    </li>
  );
}

export default function PalChat() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const inputId = useId();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<ReturnType<typeof createPalChatSession> | null>(null);
  const counterRef = useRef(0);

  const nextId = useCallback(() => {
    counterRef.current += 1;
    return `t-${counterRef.current}`;
  }, []);

  // Keep the newest turn in view as the transcript grows.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [entries, pending]);

  const ask = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || pending) return;
      sessionRef.current ??= createPalChatSession();
      setEntries((prev) => [...prev, { kind: "user", id: nextId(), text }]);
      setQuery("");
      setPending(true);
      trackEvent("concierge_ask");
      const result = await sessionRef.current(text, DEFAULT_CITY_ID);
      setPending(false);
      if (result === null) return; // superseded by a newer ask — do nothing
      if (result.status === "error") {
        setEntries((prev) => [
          ...prev,
          { kind: "error", id: nextId(), message: result.message },
        ]);
        return;
      }
      setEntries((prev) => [
        ...prev,
        { kind: "answer", id: nextId(), answer: result },
      ]);
    },
    [nextId, pending],
  );

  const onSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void ask(query);
    },
    [ask, query],
  );

  const openVenue = useCallback(() => {
    trackEvent("concierge_result_tap");
  }, []);

  const empty = entries.length === 0 && !pending;

  return (
    <main className="palChat">
      <header className="palChatHead">
        <p className="palChatEyebrow">
          <Sparkles size={14} aria-hidden="true" />
          Ask your Pub Pal
        </p>
        <h1 className="palChatTitle">{"What's the night?"}</h1>
        <p className="palChatIntro">
          Grounded answers from what we have sourced. Every card keeps its source.
          No made-up venues, prices, or events.
        </p>
      </header>

      <div className="palChatScroll" ref={scrollRef}>
        <div className="palChatTranscript" aria-live="polite">
          {entries.map((entry) => {
            if (entry.kind === "user") {
              return (
                <div key={entry.id} className="palChatRow palChatRow--user">
                  <p className="palChatBubble palChatBubble--user">{entry.text}</p>
                </div>
              );
            }
            if (entry.kind === "error") {
              return (
                <div key={entry.id} className="palChatRow palChatRow--pal">
                  <p
                    className="palChatBubble palChatBubble--error"
                    role="alert"
                  >
                    {entry.message}
                  </p>
                </div>
              );
            }
            const { answer } = entry;
            return (
              <div key={entry.id} className="palChatRow palChatRow--pal">
                <p
                  className={`palChatBubble${
                    answer.status === "empty" ? " palChatBubble--empty" : ""
                  }`}
                >
                  {answer.message}
                </p>
                {answer.cards.length > 0 ? (
                  <ul className="palChatCards">
                    {answer.cards.map((card) => (
                      <AnswerCard key={card.key} card={card} onOpen={openVenue} />
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}

          {pending ? (
            <div className="palChatRow palChatRow--pal">
              <p className="palChatBubble palChatBubble--pending">
                <span className="palChatDots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="palChatSr">Checking what is on record</span>
              </p>
            </div>
          ) : null}
        </div>

        {empty ? (
          <div className="palChatExamples" aria-label="Example asks">
            {EXAMPLE_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="palChatChip pressable"
                onClick={() => void ask(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <form className="palChatComposer" onSubmit={onSubmit}>
        <label className="palChatSr" htmlFor={inputId}>
          Describe the night
        </label>
        <input
          id={inputId}
          className="palChatInput"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Quiet-ish near Bank, not pricey"
          maxLength={500}
          enterKeyHint="send"
          autoComplete="off"
        />
        <button
          type="submit"
          className="palChatSend pressable"
          disabled={pending || !query.trim()}
          aria-label="Ask"
        >
          <ArrowUp size={18} aria-hidden="true" />
        </button>
      </form>
    </main>
  );
}
