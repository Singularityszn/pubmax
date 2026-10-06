"use client";

// Pub Pal chat surface (/pal/chat) — a chat SKIN over `/api/pub-pal/chat` (ADR 0014).
// The user asks in natural language; the tool registry answers from
// listed pubs, What's On, CityMCP, heritage, and prices. Cards keep provenance.
// Proposals need an explicit Confirm (ADR 0006). In-thread turns may refine an
// ask; durable Pal memory is written only by the person's own Confirm on a
// memory card. Web grounding stays OFF (lib/palChat PAL_WEB_GROUNDING).

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUp, MapPin, Sparkles } from "lucide-react";

import { PubPalMascot } from "@/components/pal/PubPalMascot";
import Screen from "@/components/ui/screen";

import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerSession } from "@/components/auth/useViewerSession";
import IntentLink from "@/components/nav/IntentLink";
import SiteNav from "@/components/nav/SiteNav";
import { captureAccountAuth } from "@/lib/accountBoundFetch";
import { trackEvent } from "@/lib/analytics";
import type { AskProposal } from "@/lib/ask/types";
import { occupancyReceiptLine } from "@/lib/occupancy";
import { confirmPalMemoryProposal } from "@/lib/palMemoryConfirmClient";
import { confirmOccupancyProposal } from "@/components/map/useVenueOccupancy";
import { DEFAULT_CITY_ID } from "@/lib/cities";
import { writeAskPlanDraft } from "@/lib/conciergeAskClient";
import { markConsentAnswerMoment } from "@/lib/consentAnswerMoment";
import { useKeyboardInset } from "@/lib/keyboardInset";
import {
  readSoftKeyboardOpen,
  serverSoftKeyboardOpen,
  subscribeSoftKeyboard,
} from "@/lib/softKeyboard";
import { rankNearMe } from "@/lib/nearMeAnswer";
import { CENTRAL_PATCH, readRememberedArea, resolveNightPatch } from "@/lib/nightPatches";
import {
  palKnownVenueIds,
  resolvePalVenueOpenTarget,
} from "@/lib/palOpenVenue";
import { formatPalWhen, type PalAnswer, type PalCard } from "@/lib/palChat";
import { venueAcceptUrl } from "@/lib/venueMapUrl";
import { palRecall, type PalRecall } from "@/lib/palRecall";
import { palLocalityLine, resolvePalLocality, type PalLocality } from "@/lib/palLocality";
import { planPalRouteHandoffHref } from "@/lib/planOccasion";
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
import {
  loadSlimVenuesForCity,
  loadSlimVenuesForCityResult,
} from "@/lib/venuesSlim";
import { VibeChipButton, VibeChips } from "@/components/vibe/VibeChips";
import { VIBE_CHIPS } from "@/lib/vibeChips";
import { useWhatsOnTonight } from "@/components/map/useWhatsOnTonight";

import "./palChat.css";

type Entry =
  | { kind: "user"; id: string; text: string }
  | {
      kind: "answer";
      id: string;
      answer: PalAnswer;
      locality: PalLocality | null;
      proposals: AskProposal[];
      /** In-thread recall only (lib/palRecall). Never a durable memory. */
      recall: PalRecall | null;
    }
  | { kind: "error"; id: string; message: string; needsSignIn?: boolean };

function VenueLink({
  card,
  onOpen,
  knownVenueIds,
  children,
}: {
  card: PalCard;
  onOpen: (venueId: string) => void;
  knownVenueIds: ReadonlySet<string> | null;
  children: React.ReactNode;
}) {
  // A card is only tappable when it deep-links to a real venue on the map. The
  // static variant still renders every fact and its provenance.
  if (!card.venueId) {
    return <div className="palChatCardMain">{children}</div>;
  }
  const target = resolvePalVenueOpenTarget(card.venueId, knownVenueIds);
  const href = target.href;
  return (
    <Link
      prefetch={false}
      className="palChatCardMain palChatCardBody--link"
      href={href}
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        onOpen(card.venueId);
      }}
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
  knownVenueIds = null,
  locality,
}: {
  card: PalCard;
  onOpen: (venueId: string) => void;
  knownVenueIds?: ReadonlySet<string> | null;
  locality: PalLocality | null;
}) {
  const when = card.when ? formatPalWhen(card.when) : "";
  return (
    <li className="palChatCard">
      <div className="palChatCardBody">
        <VenueLink card={card} onOpen={onOpen} knownVenueIds={knownVenueIds}>
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
          {card.venueId ? (
            <span className="palChatCardCta" aria-hidden="true">
              Show on map
            </span>
          ) : null}
        </VenueLink>
        <div className="palChatCardMeta">
          <ProvChip card={card} />
          {card.confidence ? (
            <span className="palChatConfidence">{card.confidence}</span>
          ) : null}
        </div>
      </div>
      {card.venueId ? (
        <Link
          prefetch={false}
          className="palChatCardAccept pressable"
          href={venueAcceptUrl(card.venueId, "pal")}
          onClick={() => acceptPalVenue(card, locality)}
        >
          Use this Venue
        </Link>
      ) : null}
    </li>
  );
}

export default function PalChat() {
  const router = useRouter();
  const { user, session } = useAuth();
  const viewerSession = useViewerSession();
  const auth = captureAccountAuth(user?.id ?? null, session);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  // The answer text so far while the Pal is still writing it, "" until it starts.
  const [streamText, setStreamText] = useState("");
  const [knownVenueIds, setKnownVenueIds] = useState<ReadonlySet<string> | null>(null);
  const inputId = useId();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // The composer is pinned over the foot of the page and rides up by the
  // keyboard's own inset; when the keyboard is up the tab bar has stepped
  // aside, so the bar's lane is not reserved under it.
  const keyboardInset = useKeyboardInset();
  const keyboardOpen = useSyncExternalStore(
    subscribeSoftKeyboard,
    readSoftKeyboardOpen,
    serverSoftKeyboardOpen,
  );
  const composerInput = useRef<HTMLInputElement | null>(null);
  const sessionRef = useRef<ReturnType<typeof createPalChatSession> | null>(null);
  const counterRef = useRef(0);
  // Every ask this thread has carried, oldest first. In-thread only.
  const priorAsksRef = useRef<string[]>([]);

  const nextId = useCallback(() => {
    counterRef.current += 1;
    return `t-${counterRef.current}`;
  }, []);

  useEffect(() => {
    let alive = true;
    void loadSlimVenuesForCityResult(DEFAULT_CITY_ID)
      .then((result) => {
        if (!alive) return;
        setKnownVenueIds(
          result.status === "ready" ? palKnownVenueIds(result.rows) : null,
        );
      })
      .catch(() => {
        if (!alive) return;
        setKnownVenueIds(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const openVenue = useCallback(
    (venueId: string) => {
      trackEvent("concierge_result_tap");
      const target = resolvePalVenueOpenTarget(venueId, knownVenueIds);
      router.push(target.href);
    },
    [knownVenueIds, router],
  );

  // Keep the newest turn in view as the transcript grows. The transcript ends
  // where its content ends (palChat.css), so the PAGE is the scroller and the
  // composer is pinned over its foot; the region's own scrollTop is set too
  // for the one case where it is the scroller (a bounded host).
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
    if (entries.length === 0 && !pending) return;
    const page = document.documentElement;
    if (page.scrollHeight <= window.innerHeight) return;
    window.scrollTo({ top: page.scrollHeight });
  }, [entries, pending, streamText, keyboardInset]);

  const ask = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || pending) return;
      sessionRef.current ??= createPalChatSession();
      // Read the recall BEFORE this ask joins the transcript, so the Pal never
      // recalls the question it is answering.
      const recall = palRecall(priorAsksRef.current, text);
      priorAsksRef.current = [...priorAsksRef.current, text].slice(-12);
      setEntries((prev) => [...prev, { kind: "user", id: nextId(), text }]);
      setQuery("");
      setPending(true);
      trackEvent("concierge_ask");
      const result = await sessionRef.current(text, DEFAULT_CITY_ID, setStreamText);
      setPending(false);
      setStreamText("");
      if (result === null) return; // superseded by a newer ask — do nothing
      if (result.status === "error") {
        setEntries((prev) => [
          ...prev,
          {
            kind: "error",
            id: nextId(),
            message: result.message,
            needsSignIn: result.needsSignIn,
          },
        ]);
        return;
      }
      // Ground WHERE this answer applies from the query and remembered area.
      const locality = resolvePalLocality(text, readRememberedArea());
      const proposals =
        result.status === "answered" || result.status === "empty"
          ? result.proposals ?? []
          : [];
      // An answer in the transcript is the Pal having answered, which is one of
      // the moments the analytics consent card waits behind
      // (lib/consentAnswerMoment.ts). It rides the ANSWER rather than the ask,
      // because a question nobody has replied to is still the reader waiting.
      markConsentAnswerMoment("pal-reply");
      setEntries((prev) => [
        ...prev,
        { kind: "answer", id: nextId(), answer: result, locality, proposals, recall },
      ]);
    },
    [nextId, pending],
  );

  const dismissProposal = useCallback((entryId: string, proposalId: string) => {
    setEntries((prev) =>
      prev.map((entry) => {
        if (entry.kind !== "answer" || entry.id !== entryId) return entry;
        return {
          ...entry,
          proposals: entry.proposals.filter((p) => p.id !== proposalId),
        };
      }),
    );
  }, []);

  const confirmProposal = useCallback((proposal: AskProposal, entryId?: string) => {
    if (proposal.kind === "open_venue") {
      openVenue(proposal.venueId);
      return;
    }
    trackEvent("concierge_result_tap");
    if (proposal.kind === "fly_to") {
      const params = new URLSearchParams({
        lat: String(proposal.lat),
        lng: String(proposal.lng),
      });
      if (proposal.place) params.set("place", proposal.place);
      router.push(`/map?${params.toString()}`);
      return;
    }
    if (proposal.kind === "report_occupancy") {
      void (async () => {
        const result = await confirmOccupancyProposal(
          { venueId: proposal.venueId, level: proposal.level },
          auth,
          "pal",
        );
        if (!result.ok && result.needsSignIn) {
          router.push("/login?mode=signin&from=/pal/chat");
          return;
        }
        if (!result.ok) {
          setEntries((prev) => [
            ...prev,
            { kind: "error", id: nextId(), message: result.error },
          ]);
          return;
        }
        const level = result.reading.now ?? proposal.level;
        const age = result.reading.ageMinutes ?? 0;
        setEntries((prev) => [
          ...prev,
          {
            kind: "answer",
            id: nextId(),
            answer: {
              status: "answered",
              message: occupancyReceiptLine(level, age),
              cards: [],
            },
            locality: null,
            proposals: [],
            recall: null,
          },
        ]);
        if (entryId) dismissProposal(entryId, proposal.id);
      })();
      return;
    }
    if (proposal.kind === "remember_memory") {
      void (async () => {
        const result = await confirmPalMemoryProposal(
          { id: proposal.id, memoryKind: proposal.memoryKind, value: proposal.value },
          auth,
        );
        if (!result) return;
        if (!result.ok && result.needsSignIn) {
          router.push("/login?mode=signin&from=/pal/chat");
          return;
        }
        if (!result.ok) {
          setEntries((prev) => [
            ...prev,
            { kind: "error", id: nextId(), message: result.error },
          ]);
          return;
        }
        setEntries((prev) => [
          ...prev,
          {
            kind: "answer",
            id: nextId(),
            answer: {
              status: "answered",
              message: `Saved. I will remember: ${proposal.value}`,
              cards: [],
            },
            locality: null,
            proposals: [],
            recall: null,
          },
        ]);
        if (entryId) dismissProposal(entryId, proposal.id);
      })();
    }
  }, [auth, dismissProposal, nextId, openVenue, router]);

  const onSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void ask(query);
    },
    [ask, query],
  );

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
    <>
      <SiteNav />
      {/* The launch head (docs/design/LAUNCH_SCREENS.md): kicker and heading.
          This is a form screen, so its ONE painted control is the composer's
          own submit beside the field (captain's ruling, 7 Sep 2026); a head
          Send above the transcript was a second door for one action. */}
      <Screen
        as="main"
        id="main"
        className="palChat pageHidesCreateFab"
        kicker={
          <>
            <PubPalMascot size={18} circular />
            Your Pub Pal
          </>
        }
        title={"What's the night?"}
        titleId="pal-chat-title"
        lede="Straight answers from what we have actually seen. Every card keeps its source. No made-up venues, prices, or events."
        secondary={<Link prefetch={false} href="/pal">Back to your Pub Pal</Link>}
      >

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
                    {/* A 401 while the session is still loading is not
                        sign-out, so the door waits for the live answer. */}
                    {entry.needsSignIn && viewerSession.signedOut ? (
                      <>
                        {" "}
                        <Link
                          prefetch={false}
                          className="palGlanceExit"
                          href="/login?mode=signin&from=/pal/chat"
                        >
                          Sign in
                        </Link>
                      </>
                    ) : null}
                  </p>
                </div>
              );
            }
            const { answer, locality, proposals, recall } = entry;
            return (
              <div key={entry.id} className="palChatRow palChatRow--pal">
                <p
                  className={`palChatBubble${
                    answer.status === "empty" ? " palChatBubble--empty" : ""
                  }`}
                >
                  {answer.message}
                </p>
                {recall ? (
                  <p className="palChatRecall" role="note">
                    {recall.line}
                  </p>
                ) : null}
                {locality ? (
                  <p className="palChatLocality" role="note">
                    {palLocalityLine(locality)}
                  </p>
                ) : null}
                {proposals.length > 0 ? (
                  <ul className="palChatProposals" aria-label="Suggested actions">
                    {proposals.map((proposal) => (
                      <li key={proposal.id} className="palChatProposal">
                        {proposal.kind === "draft_plan" ? (
                          <IntentLink
                            className="palChatPlanHandoff pressable"
                            href={planPalRouteHandoffHref(proposal.query)}
                            onClick={() => {
                              trackEvent("concierge_result_tap");
                              writeAskPlanDraft({
                                query: proposal.query,
                                stopIds: proposal.stopIds,
                                stopNames: proposal.stopNames,
                                createdAt: new Date().toISOString(),
                              });
                            }}
                          >
                            Open in Plan
                          </IntentLink>
                        ) : (
                          <button
                            type="button"
                            className="palChatProposalConfirm pressable"
                            onClick={() => confirmProposal(proposal, entry.id)}
                          >
                            {proposal.label}
                          </button>
                        )}
                        <button
                          type="button"
                          className="palChatProposalDismiss pressable"
                          onClick={() => dismissProposal(entry.id, proposal.id)}
                        >
                          Dismiss
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {proposals.some((proposal) => proposal.kind === "remember_memory") ? (
                  <p className="palChatProposalNote">
                    A saved memory goes with each Pub Pal chat to ElevenLabs, which answers it. You can delete it on your Pal page.
                  </p>
                ) : null}
                {answer.cards.length > 0 ? (
                  <ul className="palChatCards">
                    {answer.cards.map((card) => (
                      <AnswerCard
                        key={card.key}
                        card={card}
                        onOpen={openVenue}
                        knownVenueIds={knownVenueIds}
                        locality={locality}
                      />
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}

          {pending && streamText ? (
            // The answer as the Pal writes it. The cards and any proposal arrive
            // with the finished answer, which replaces this bubble in place.
            // It is not announced word by word: the finished answer is.
            <div className="palChatRow palChatRow--pal">
              <p className="palChatBubble" aria-live="off" aria-busy="true" data-testid="pal-streaming-answer">
                {streamText}
              </p>
            </div>
          ) : pending ? (
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
          <VibeChips shellClassName="palChatExamples" groupLabel="Pick a vibe">
            {VIBE_CHIPS.map((chip) => (
              <VibeChipButton
                key={chip.id}
                onClick={() => {
                  trackEvent("tonight_vibe_select", { vibe: chip.id });
                  void ask(chip.ask);
                }}
              >
                {chip.label}
              </VibeChipButton>
            ))}
          </VibeChips>
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
              <Link prefetch={false} className="palGlanceExit" href={`/map/${DEFAULT_CITY_ID}`}>
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
              <Link prefetch={false} className="palGlanceExit" href="/near">
                See the list.
              </Link>
            </p>
          </div>
        ) : null}
      </div>

      <form
        className="palChatComposer"
        onSubmit={onSubmit}
        data-keyboard-open={keyboardOpen ? "" : undefined}
        style={{ "--keyboard-inset": `${keyboardInset}px` } as React.CSSProperties}
      >
        <label className="palChatSr" htmlFor={inputId}>
          Describe the outing
        </label>
        <input
          id={inputId}
          ref={composerInput}
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
          data-primary-action=""
          disabled={pending || !query.trim()}
          aria-label="Ask"
        >
          <ArrowUp size={18} aria-hidden="true" />
        </button>
      </form>
      </Screen>
    </>
  );
}
