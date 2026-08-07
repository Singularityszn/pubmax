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

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, MapPin, Sparkles } from "lucide-react";

import { trackEvent } from "@/lib/analytics";
import { DEFAULT_CITY_ID } from "@/lib/cities";
import { rankNearMe } from "@/lib/nearMeAnswer";
import { CENTRAL_PATCH, readRememberedArea, resolveNightPatch } from "@/lib/nightPatches";
import { formatPalWhen, type PalAnswer, type PalCard } from "@/lib/palChat";
import { palLocalityLine, resolvePalLocality, type PalLocality } from "@/lib/palLocality";
import { writePlanningIntent } from "@/lib/planningIntent";
import { createPalChatSession } from "@/lib/palChatClient";
import {
  cheapestGlanceLine,
  countTonightKinds,
  GLANCE_QUIET_EXIT,
  GLANCE_QUIET_LINE,
  tonightGlanceLine,
  type CheapestGlanceCard,
} from "@/lib/palGlance";
import { formatPrice } from "@/lib/venues";
import { loadSlimVenuesForCity } from "@/lib/venuesSlim";
import { VIBE_CHIPS } from "@/lib/vibeChips";
import { useWhatsOnTonight } from "@/components/map/useWhatsOnTonight";

import "./palChat.css";

type Entry =
  | { kind: "user"; id: string; text: string }
  | { kind: "answer"; id: string; answer: PalAnswer; locality: PalLocality | null }
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

// Explicit Pub Pal acceptance (§4.8: Pal owns its own "Use this Venue", distinct
// from browsing). Writes a source-"pal" PlanningIntent then hands off to the Map
// acceptance URL. Storage failure is swallowed by writePlanningIntent; the href
// still carries accept=1&src=pal so the handoff never depends on client storage.
function acceptPalVenue(card: PalCard, locality: PalLocality | null): void {
  writePlanningIntent({
    source: "pal",
    cityId: DEFAULT_CITY_ID,
    acceptedVenueId: card.venueId,
    acceptedArea: locality?.area ?? null,
    startsAt: null,
    displayEvidence: {
      kind: card.provenance.kind === "whats-on" ? "whats-on" : "directory",
      observedAt: card.when ?? null,
    },
  });
  trackEvent("venue_accepted", { source: "pal" });
}

export function AnswerCard({
  card,
  onOpen,
  palHandoff,
  locality,
}: {
  card: PalCard;
  onOpen: () => void;
  palHandoff: boolean;
  locality: PalLocality | null;
}) {
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
      {palHandoff && card.venueId ? (
        <Link
          className="palChatCardAccept pressable"
          href={`/map?sel=${encodeURIComponent(card.venueId)}&accept=1&src=pal`}
          onClick={() => acceptPalVenue(card, locality)}
        >
          Use this Venue
        </Link>
      ) : null}
    </li>
  );
}

export default function PalChat({ palHandoff = false }: { palHandoff?: boolean }) {
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
      // Ground WHERE this answer applies from the query and remembered area,
      // only when the handoff is on. Off = no locality copy, byte-identical.
      const locality = palHandoff ? resolvePalLocality(text, readRememberedArea()) : null;
      setEntries((prev) => [
        ...prev,
        { kind: "answer", id: nextId(), answer: result, locality },
      ]);
    },
    [nextId, pending, palHandoff],
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

  // Vibe deep link (?ask=...): a Tonight vibe chip can hand its preset ask to
  // this surface pre-fired. Read from location once on mount — a client-only,
  // fire-once concern, so plain location.search avoids wrapping the page in a
  // useSearchParams Suspense boundary. The ref (not `pending`) guards double
  // fire under StrictMode re-mounts.
  const autoAskedRef = useRef(false);
  useEffect(() => {
    if (autoAskedRef.current) return;
    autoAskedRef.current = true;
    const preset = new URLSearchParams(window.location.search).get("ask");
    const text = preset?.trim() ?? "";
    if (!text || text.length > 500) return;
    // Defer out of the effect body (React 19 idiom, as TonightClient's
    // settle()): ask() sets state, which must not run synchronously here.
    const timer = setTimeout(() => void ask(text), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once on mount
  }, []);

  const empty = entries.length === 0 && !pending;
  // Tonight-at-a-glance data: the same /api/whats-on spine the map fetches,
  // enabled only while the transcript is empty (one light fetch; the glance
  // leaves the moment the conversation starts).
  const glance = useWhatsOnTonight(empty);
  const glanceLine = useMemo(
    () => tonightGlanceLine(countTonightKinds(glance.rows)),
    [glance.rows],
  );

  // Cheapest-pint glance row (judge-w2 polish item 1): the second honest value
  // row for the first-open gap. One slim-index load while the transcript is
  // empty, ranked from the remembered patch (or central London) through the
  // SAME rankNearMe answer Near me serves. Silent on any failure — the glance
  // never apologises.
  const [cheapest, setCheapest] = useState<{
    areaLabel: string;
    card: CheapestGlanceCard;
  } | null>(null);
  useEffect(() => {
    if (!empty || cheapest) return;
    let alive = true;
    void loadSlimVenuesForCity(DEFAULT_CITY_ID)
      .then((slim) => {
        if (!alive || slim.length === 0) return;
        const remembered = readRememberedArea();
        const patch =
          (remembered?.kind === "patch" ? resolveNightPatch(remembered.id) : null) ??
          CENTRAL_PATCH;
        const answer = rankNearMe(patch.lat, patch.lng, slim);
        const card = answer.cards[0];
        if (!card) return;
        setCheapest({
          areaLabel: patch.label,
          card: {
            name: card.name,
            cheapestPrice: card.cheapestPrice,
            walkMinutes: card.walkMinutes ?? null,
          },
        });
      })
      .catch(() => {
        // Slim index unavailable: render nothing, the ask path owns honesty.
      });
    return () => {
      alive = false;
    };
  }, [empty, cheapest]);
  const cheapestLine = useMemo(
    () => (cheapest ? cheapestGlanceLine(cheapest.areaLabel, cheapest.card, formatPrice) : null),
    [cheapest],
  );

  return (
    <main id="main" className="palChat">
      <header className="palChatHead">
        {palHandoff ? (
          <Link className="palChatBack" href="/pal">
            ← Pub Pal
          </Link>
        ) : null}
        <p className="palChatEyebrow">
          <Sparkles size={14} aria-hidden="true" />
          Ask your Pub Pal
        </p>
        <h1 className="palChatTitle">{"What's the night?"}</h1>
        <p className="palChatIntro">
          Straight answers from what we have actually seen. Every card keeps its
          source. No made-up venues, prices, or events.
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
            const { answer, locality } = entry;
            return (
              <div key={entry.id} className="palChatRow palChatRow--pal">
                <p
                  className={`palChatBubble${
                    answer.status === "empty" ? " palChatBubble--empty" : ""
                  }`}
                >
                  {answer.message}
                </p>
                {palHandoff && locality ? (
                  <p className="palChatLocality" role="note">
                    {palLocalityLine(locality)}
                  </p>
                ) : null}
                {answer.cards.length > 0 ? (
                  <ul className="palChatCards">
                    {answer.cards.map((card) => (
                      <AnswerCard
                        key={card.key}
                        card={card}
                        onOpen={openVenue}
                        palHandoff={palHandoff}
                        locality={locality}
                      />
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
          /* Vibe quick-asks (docs/VIBE_LAYER_SPEC_2026-07-19.md): the chip
             label is the user's voice; the press fires the chip's parser-tuned
             preset through the same deterministic ask path as typed text. */
          <div className="palChatExamples" aria-label="Pick a vibe">
            {VIBE_CHIPS.map((chip) => (
              <button
                key={chip.id}
                type="button"
                className="palChatChip palChatChip--vibe pressable"
                onClick={() => {
                  trackEvent("tonight_vibe_select", { vibe: chip.id });
                  void ask(chip.ask);
                }}
              >
                {chip.label}
              </button>
            ))}
          </div>
        ) : null}

        {/* Tonight at a glance (judge-w1 wave 2): real spine counts fill the
            first-open dead zone with receipts. Renders only before the first
            ask; an outage renders nothing (the glance never apologises — the
            ask path owns error honesty when the user actually asks). */}
        {empty && glance.status === "ready" && glanceLine ? (
          <div className="palGlance" role="note" aria-label="Tonight at a glance">
            <span className="palGlanceLabel">
              <Sparkles size={13} aria-hidden="true" /> Tonight
            </span>
            <p className="palGlanceLine">{glanceLine}</p>
          </div>
        ) : null}
        {empty && glance.status === "empty" ? (
          <div className="palGlance" role="note" aria-label="Tonight at a glance">
            <span className="palGlanceLabel">
              <Sparkles size={13} aria-hidden="true" /> Tonight
            </span>
            <p className="palGlanceLine">
              {GLANCE_QUIET_LINE}{" "}
              <Link className="palGlanceExit" href={`/map/${DEFAULT_CITY_ID}`}>
                {GLANCE_QUIET_EXIT}
              </Link>
            </p>
          </div>
        ) : null}

        {/* Cheapest-pint row (judge-w2 polish item 1): same rankNearMe answer
            Near me serves, from the remembered patch. Absent = renders nothing. */}
        {empty && cheapestLine ? (
          <div className="palGlance" role="note" aria-label="Cheapest pint nearby">
            <span className="palGlanceLabel">
              <MapPin size={13} aria-hidden="true" /> Cheapest
            </span>
            <p className="palGlanceLine">
              {cheapestLine}{" "}
              <Link className="palGlanceExit" href="/near">
                See the list.
              </Link>
            </p>
          </div>
        ) : null}
      </div>

      <form className="palChatComposer" onSubmit={onSubmit}>
        <label className="palChatSr" htmlFor={inputId}>
          Describe the outing
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
