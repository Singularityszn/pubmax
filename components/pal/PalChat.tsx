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
import type { Route } from "next";

import PalCardPrice from "@/components/pal/PalCardPrice";
import { useRouter } from "next/navigation";
import { ArrowUp, MapPin, Sparkles } from "lucide-react";

import PalChatCompanion from "./PalChatCompanion";
import { PubPalMascot } from "@/components/pal/PubPalMascot";
import PalRecommendationMap from "@/components/pal/PalRecommendationMap";
import Screen from "@/components/ui/screen";
import { Button } from "@/components/ui/button";

import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerSession } from "@/components/auth/useViewerSession";
import IntentLink from "@/components/nav/IntentLink";
import SiteNav from "@/components/nav/SiteNav";
import { captureAccountAuth } from "@/lib/accountBoundFetch";
import { trackEvent } from "@/lib/analytics";
import type { AskProposal, AskTurn } from "@/lib/ask/types";
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
  palFlyToHref,
  palKnownVenueIds,
  resolvePalVenueOpenTarget,
} from "@/lib/palOpenVenue";
import { isPlanActiveNow, readActivePlan } from "@/lib/activePlan";
import { readPlanMemberProjection } from "@/components/plan/usePlanMemberRead";
import {
  palNextStop,
  palNightStopsFrom,
  palAsksForMap,
  palVoiceMapIntent,
} from "@/lib/palVoiceTranscript";
import { palMapAskTarget, palPubAskVenue, type PalMapAskVenue } from "@/lib/palMapAsk";
import { formatPalWhen, type PalCard } from "@/lib/palChat";
import { venueAcceptUrl, venueMapUrl } from "@/lib/venueMapUrl";
import { palRecall } from "@/lib/palRecall";
import { palLocalityLine, resolvePalLocality, type PalLocality } from "@/lib/palLocality";
import { PLAN_FIELD_LABEL } from "@/lib/planCopy";
import { planPalRouteHandoffHref } from "@/lib/planOccasion";
import { writePlanningIntent } from "@/lib/planningIntent";
import { authedActionFetch } from "@/lib/authedFetch";
import { palChatResultFromBody } from "@/lib/palChatClient";
import { palOpeningMessage } from "@/lib/palOpening";
import { createPalChatSession, PAL_CHAT_TIMEOUT_MS } from "@/lib/palChatClient";
import { clearPalChatThread, palChatMapAnswer, readPalChatThread, savePalChatThread, type PalChatEntry as Entry, type PalChatThread } from "@/lib/palChatThread";
import {
  cheapestGlanceLine,
  cheapestGlanceReceipt,
  countTonightKinds,
  GLANCE_QUIET_EXIT,
  GLANCE_QUIET_LINE,
  tonightGlanceLine,
  tonightGlanceReceipt,
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

/**
 * What "take me there" points at in the written chat: the newest Pal answer
 * only, never an older one. Its first pub proposal, else its first pub card;
 * with neither, its words are read for a listed pub (lib/palMapAsk.ts).
 */
function palLastAnswerVenue(entries: readonly Entry[]): {
  venue: PalMapAskVenue | null;
  palLines: string[];
} {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.kind !== "answer") continue;
    const { cards, message } = entry.answer;
    const cardName = (venueId: string): string | undefined => {
      const card = cards.find((row) => row.venueId === venueId);
      // A journey card is titled "Journey 1" and names the pub as its place.
      return card ? (/^Journey \d/.test(card.title) ? card.place : card.title) || undefined : undefined;
    };
    for (const proposal of entry.proposals) {
      if (proposal.kind === "open_venue") {
        return {
          venue: { id: proposal.venueId, name: cardName(proposal.venueId) ?? proposal.label.replace(/^Open\s+/, "") },
          palLines: [],
        };
      }
      if (proposal.kind === "fly_to" && proposal.venueId) {
        return {
          venue: { id: proposal.venueId, name: cardName(proposal.venueId) ?? proposal.place ?? proposal.label },
          palLines: [],
        };
      }
    }
    const card = cards.find((row) => row.venueId);
    if (card) return { venue: { id: card.venueId, name: cardName(card.venueId) ?? card.title }, palLines: [] };
    return { venue: null, palLines: [message] };
  }
  return { venue: null, palLines: [] };
}

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

// Explicit Pub Pal acceptance (§4.8: Pal owns its own "Use this pub", distinct
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
            <PalCardPrice card={card} className="palChatCardPrice" />
          </div>
          {card.place ? (
            <p className="palChatCardPlace">
              <MapPin size={14} aria-hidden="true" />
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
          {[card.menuEvidence?.caloriesProvenance, card.menuEvidence?.dietaryProvenance].map((field, index) => field && field.sourceUrl !== card.provenance.url ? (
            <a key={index} className="palChatProv palChatProv--link" href={field.sourceUrl} target="_blank" rel="noreferrer noopener">
              {index === 0 ? "Calorie source" : "Dietary source"}: {field.source}
            </a>
          ) : null)}
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
          Use this pub
        </Link>
      ) : null}
    </li>
  );
}

export default function PalChat() {
  const { user } = useAuth();
  const viewer = useViewerSession();
  const owner = user?.id ?? (viewer.signedOut ? "anonymous" : null);
  return <PalChatBody key={user?.id ?? "anonymous"} owner={owner} />;
}

function PalChatBody({ owner }: { owner: string | null }) {
  const router = useRouter();
  const { user, session, providerAuthState } = useAuth();
  const viewerSession = useViewerSession();
  const auth = captureAccountAuth(user?.id ?? null, session);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [query, setQuery] = useState("");
  const [threadReady, setThreadReady] = useState(false);
  const browserReady = useSyncExternalStore(() => () => {}, () => true, () => false);
  const inputReady = threadReady && browserReady && owner !== null;
  const [pending, setPending] = useState(false);
  // The answer text so far while the Pal is still writing it, "" until it starts.
  const [streamText, setStreamText] = useState("");
  const [knownVenueIds, setKnownVenueIds] = useState<ReadonlySet<string> | null>(null);
  const inputId = useId();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const newestAnswerRef = useRef<HTMLDivElement | null>(null);
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
  const openingReadRef = useRef(0);
  const sessionRef = useRef<ReturnType<typeof createPalChatSession> | null>(null);
  const counterRef = useRef(0);
  // Every ask this thread has carried, oldest first. In-thread only.
  const priorAsksRef = useRef<string[]>([]);
  const conversationRef = useRef({ id: "", at: 0 });
  const turnsRef = useRef<AskTurn[]>([]);
  const savedEntriesRef = useRef<Entry[] | null>(null);
  const createSession = useCallback((initial?: Pick<PalChatThread, "turns" | "conversationId">) => createPalChatSession({
    initialTurns: initial?.turns,
    initialConversationId: initial?.conversationId,
    onConversationId(id) { conversationRef.current = { id, at: Date.now() }; },
    onTurns(turns) { turnsRef.current = turns; },
  }), []);

  useEffect(() => {
    if (!owner || pending || !entries.length || entries === savedEntriesRef.current) return;
    const controller = new AbortController();
    void savePalChatThread(owner, entries, conversationRef.current.id, conversationRef.current.at, turnsRef.current, controller.signal).catch(() => {});
    savedEntriesRef.current = entries;
    return () => { controller.abort(); };
  }, [entries, pending, owner]);

  const nextId = useCallback(() => {
    counterRef.current += 1;
    return `t-${counterRef.current}`;
  }, []);

  useEffect(() => {
    if (!owner || entries.length || sessionRef.current) return;
    const request = ++openingReadRef.current;
    let active = true;
    let restoreTimeout: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      try {
        const saved = await Promise.race([
          readPalChatThread(owner),
          new Promise<never>((_resolve, reject) => {
            restoreTimeout = setTimeout(() => reject(new Error("History load timed out")), PAL_CHAT_TIMEOUT_MS);
          }),
        ]);
        if (!active || request !== openingReadRef.current) return;
        setThreadReady(true);
        if (saved?.entries.length) {
          sessionRef.current = createSession(saved);
          conversationRef.current = { id: saved.conversationId, at: saved.conversationAt };
          counterRef.current = saved.entries.length;
          priorAsksRef.current = saved.priorAsks;
          turnsRef.current = saved.turns;
          savedEntriesRef.current = saved.entries;
          setEntries(saved.entries);
          return;
        }
      } catch {
        if (active && request === openingReadRef.current) {
          const failure: Entry[] = [{ kind: "error", id: nextId(), message: "Your earlier conversation could not be restored. Start a new conversation to continue." }];
          savedEntriesRef.current = failure;
          setEntries(failure);
        }
        return;
      } finally {
        clearTimeout(restoreTimeout);
      }
      if (owner === "anonymous") return;
      let answer = palOpeningMessage("", { memories: null, taste: null });
      let conversationId = "";
      try {
        const response = await authedActionFetch("/api/pub-pal/chat", { method: "GET" }, { requiresIdentity: true });
        const body = await response.json();
        const result = palChatResultFromBody(body);
        if (response.ok && result.status !== "error") {
          answer = result.message;
          conversationId = typeof body.conversationId === "string" ? body.conversationId : "";
        }
      } catch { /* Keep an honest unavailable opening. */ }
      if (!active || request !== openingReadRef.current || sessionRef.current || priorAsksRef.current.length) return;
      const turns: AskTurn[] = [{ role: "assistant", content: answer }];
      sessionRef.current = createSession({ turns, conversationId });
      turnsRef.current = turns;
      conversationRef.current = { id: conversationId, at: Date.now() };
      setEntries([{ kind: "answer", id: nextId(), answer: { status: "empty", message: answer, cards: [] }, locality: null, proposals: [], recall: null }]);
    })();
    return () => { active = false; clearTimeout(restoreTimeout); };
  }, [owner, entries.length, createSession, nextId]);

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
    if (document.activeElement?.matches(".palChatMap")) return;
    const last = entries.at(-1);
    if (!pending && last?.kind === "answer" && last.answer.cards.length > 0 && newestAnswerRef.current?.scrollIntoView) {
      newestAnswerRef.current.scrollIntoView({ block: "start" });
      return;
    }
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
    if (entries.length === 0 && !pending) return;
    const page = document.documentElement;
    if (page.scrollHeight <= window.innerHeight) return;
    window.scrollTo({ top: page.scrollHeight });
  }, [entries, pending, streamText, keyboardInset]);

  // "Show me the map", or "next stop" while a planned night is on, is the
  // person asking to GO to the map, so it goes there (the same decision the
  // voice panel makes, palVoiceMapIntent) instead of reaching the Pal, which
  // can only answer it in words. Any later ask retires a next-stop read.
  // "Take me there" and "where is The Lamb?" open that one pub when the chat
  // can name it, and otherwise reach the Pal, unless they ask for the map too.
  const mapAskRef = useRef(0);
  const entriesRef = useRef<Entry[]>([]);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);
  const openMapFromAsk = useCallback(
    async (text: string): Promise<boolean> => {
      const request = ++mapAskRef.current;
      const plan = readActivePlan();
      const intent = palVoiceMapIntent(text, isPlanActiveNow(plan, Date.now()));
      if (!intent) return false;
      if (intent === "map") {
        const current = palChatMapAnswer(entriesRef.current);
        const map = scrollRef.current?.querySelector<HTMLElement>(".palChatMap");
        if (current && current.answer.cards.some((card) => card.venueId) && map) {
          setEntries((prev) => [...prev, { kind: "user", id: nextId(), text }]);
          setQuery((value) => value.trim() === text ? "" : value);
          map.focus({ preventScroll: true });
          map.scrollIntoView({ block: "center" });
          return true;
        }
      }
      let href: string = "/map";
      let line = "Opening the map";
      if (intent === "pub") {
        const last = palLastAnswerVenue(entriesRef.current);
        const venue = await palPubAskVenue(text, {
          lastVenue: last.venue,
          palLines: last.palLines,
          loadVenues: () => loadSlimVenuesForCity(DEFAULT_CITY_ID),
        });
        if (request !== mapAskRef.current) return true;
        if (venue) {
          href = resolvePalVenueOpenTarget(venue.id, knownVenueIds).href;
          line = `Opening ${venue.name}`;
        } else if (palMapAskTarget(text)?.kind !== "last" || !palAsksForMap(text)) {
          return false;
        }
      }
      setEntries((prev) => [...prev, { kind: "user", id: nextId(), text }]);
      setQuery((current) => current.trim() === text ? "" : current);
      if (intent === "next-stop" && plan) {
        const body = await readPlanMemberProjection(plan.id);
        if (request !== mapAskRef.current) return true;
        const next = palNextStop(palNightStopsFrom(body), plan.stopIndex);
        if (next) {
          href = next.href;
          line = `Opening ${next.venueName}, your next stop`;
        }
      }
      setEntries((prev) => [
        ...prev,
        {
          kind: "answer",
          id: nextId(),
          answer: { status: "answered", message: line, cards: [] },
          locality: null,
          proposals: [],
          recall: null,
        },
      ]);
      router.push(href as Route);
      return true;
    },
    [knownVenueIds, nextId, router],
  );

  const ask = useCallback(
    async (raw: string, options: { preserveDraft?: boolean } = {}) => {
      const text = raw.trim();
      if (!text || pending || !owner || !threadReady) return;
      openingReadRef.current += 1;
      if (await openMapFromAsk(text)) return;
      sessionRef.current ??= createSession();
      // Read the recall BEFORE this ask joins the transcript, so the Pal never
      // recalls the question it is answering.
      const recall = palRecall(priorAsksRef.current, text);
      priorAsksRef.current = [...priorAsksRef.current, text].slice(-12);
      setEntries((prev) => [...prev, { kind: "user", id: nextId(), text }]);
      if (!options.preserveDraft) {
        setQuery((current) => current.trim() === text ? "" : current);
      }
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
            retryQuery: text,
          },
        ]);
        return;
      }
      // Ground WHERE this answer applies from the query and remembered area.
      const locality = resolvePalLocality(result.routedQuery ?? text, readRememberedArea());
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
    [nextId, openMapFromAsk, pending, createSession, owner, threadReady],
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
      router.push(palFlyToHref(proposal, knownVenueIds));
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
          {
            id: proposal.id,
            memoryKind: proposal.memoryKind,
            value: proposal.value,
            relation: proposal.relation,
            supersedesMemoryId: proposal.supersedesMemoryId,
            supersedesValue: proposal.supersedesValue,
          },
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
              message:
                proposal.relation === "delete"
                  ? `Forgotten: ${proposal.value}`
                  : proposal.relation === "update"
                    ? `Updated. I'll remember: ${proposal.value}`
                    : `Saved. I'll remember: ${proposal.value}`,
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
  }, [auth, dismissProposal, knownVenueIds, nextId, openVenue, router]);

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
    if (!owner || !threadReady || autoAskedRef.current) return;
    autoAskedRef.current = true;
    const preset = new URLSearchParams(window.location.search).get("ask");
    const text = preset?.trim() ?? "";
    if (!text || text.length > 500) return;
    // Defer out of the effect body (React 19 idiom, as TonightClient's
    // settle()): ask() sets state, which must not run synchronously here.
    const timer = setTimeout(() => {
      if (priorAsksRef.current.at(-1) !== text) void ask(text);
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once after owner and history settlement
  }, [owner, threadReady]);

  const empty = entries.length === 0 && !pending;
  const mappedAnswer = palChatMapAnswer(entries);
  const mappedAnswerId = mappedAnswer?.answer.cards.some((card) => card.venueId) ? mappedAnswer.id : undefined;
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
        const listed = slim.find((row) => row.id === card.id);
        setCheapest({
          areaLabel: patch.label,
          card: {
            id: card.id,
            scope: answer.scope,
            priceSource: listed?.priceSource,
            priceObservedAt: listed?.priceObservedAt,
            name: card.name,
            cheapestPrice: card.cheapestPrice,
            // The ranker measured from the middle of the area, not from the
            // reader, and nobody has shared where they are. "About 11 min on
            // foot" would read as their walk, so the line names no minutes.
            walkMinutes: null,
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
        lede="Straight answers from what we've actually seen. Every card shows its source. No made-up venues, prices or events."
        secondary={<Link prefetch={false} href="/pal">Back to your Pub Pal</Link>}
      >

      <PalChatCompanion owner={owner} state={pending ? streamText ? "speaking" : "thinking" : "idle"} />

      {!empty ? <button type="button" className="palChatReset" disabled={pending} onClick={() => {
        openingReadRef.current += 1;
        if (owner) clearPalChatThread(owner);
        mapAskRef.current += 1;
        sessionRef.current = null;
        priorAsksRef.current = [];
        conversationRef.current = { id: "", at: 0 };
        turnsRef.current = [];
        savedEntriesRef.current = null;
        counterRef.current = 0;
        setEntries([]);
        setThreadReady(true);
        setQuery("");
        composerInput.current?.focus();
      }}>New conversation</button> : null}

      <div className="palChatScroll" ref={scrollRef}>
        <div className="palChatTranscript" aria-live="polite">
          {empty ? (
            <div className="palChatRow palChatRow--pal">
              <p className="palChatBubble">Hi. What kind of night are you planning?</p>
            </div>
          ) : null}
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
                  {entry.retryQuery && !entry.needsSignIn ? (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={!inputReady || pending}
                      aria-label={`Ask again: ${entry.retryQuery}`}
                      onClick={() => { if (entry.retryQuery) void ask(entry.retryQuery, { preserveDraft: true }); }}
                    >
                      Ask again
                    </Button>
                  ) : null}
                </div>
              );
            }
            const { answer, locality, proposals, recall } = entry;
            const actions = proposals.filter((proposal) => proposal.kind !== "open_venue"
              || !answer.cards.some((card) => card.venueId === proposal.venueId));
            return (
              <div key={entry.id} className="palChatRow palChatRow--pal" ref={entry.id === entries.at(-1)?.id ? newestAnswerRef : undefined}>
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
                {/* The line scopes the cards or a place the reader named. A reply
                    with neither, such as a greeting, has nothing to scope. */}
                {locality &&
                (answer.cards.length > 0 ||
                  locality.scope === "query" ||
                  locality.unplaced ||
                  locality.askedLondon) ? (
                  <p className="palChatLocality" role="note">
                    {palLocalityLine(locality)}
                  </p>
                ) : null}
                {entry.id === mappedAnswerId ? <PalRecommendationMap cards={answer.cards} /> : null}
                {actions.length > 0 ? (
                  <ul className="palChatProposals" aria-label="Suggested actions">
                    {actions.map((proposal) => (
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
                            {proposal.kind === "remember_memory" && proposal.relation === "update" && proposal.supersedesValue ? (
                              <span className="palChatProposalReplaces">Replaces: {proposal.supersedesValue}</span>
                            ) : null}
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
                <span className="palChatSr">Checking what&apos;s on record</span>
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
                disabled={!inputReady || pending}
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
              <Sparkles size={14} aria-hidden="true" /> Tonight
            </span>
            <p className="palGlanceLine">{glanceLine}</p>
            <p className="palGlanceReceipt">
              {tonightGlanceReceipt(glance.rows)}{" "}
              <Link prefetch={false} className="palGlanceExit" href="/tonight">
                See listings and sources.
              </Link>
            </p>
          </div>
        ) : null}
        {empty && glance.status === "empty" ? (
          <div className="palGlance" role="note" aria-label="Tonight at a glance">
            <span className="palGlanceLabel">
              <Sparkles size={14} aria-hidden="true" /> Tonight
            </span>
            <p className="palGlanceLine">
              {GLANCE_QUIET_LINE}{" "}
              <Link prefetch={false} className="palGlanceExit" href={`/map/${DEFAULT_CITY_ID}`}>
                {GLANCE_QUIET_EXIT}
              </Link>
            </p>
            <p className="palGlanceReceipt">
              No listing sources returned.{" "}
              <Link prefetch={false} className="palGlanceExit" href="/tonight">
                See listings and sources.
              </Link>
            </p>
          </div>
        ) : null}

        {/* Cheapest-pint row (judge-w2 polish item 1): same rankNearMe answer
            Near me serves, from the remembered patch. Absent = renders nothing. */}
        {empty && cheapestLine ? (
          <div className="palGlance" role="note" aria-label="Listed price nearby">
            <span className="palGlanceLabel">
              <MapPin size={14} aria-hidden="true" /> Listed price
            </span>
            <p className="palGlanceLine">
              {cheapestLine}{" "}
              <Link prefetch={false} className="palGlanceExit" href="/near">
                See the list.
              </Link>
            </p>
            {cheapest ? (
              <p className="palGlanceReceipt">
                {cheapestGlanceReceipt(cheapest.card)}{" "}
                Listed in the pint dataset. Serving size, offer and entry terms are not recorded.{" "}
                {cheapest.card.id ? (
                  <Link prefetch={false} className="palGlanceExit" href={venueMapUrl(cheapest.card.id)}>
                    Price source and venue details.
                  </Link>
                ) : null}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {!owner ? <p role="status">
        {providerAuthState !== "unavailable" ? "Checking your account before you type." : "Your account could not be checked. Try again before you type."}
        {providerAuthState === "unavailable" ? <Button type="button" variant="ghost" onClick={() => window.location.reload()}>Try account check again</Button> : null}
      </p> : null}
      <form
        className="palChatComposer"
        onSubmit={onSubmit}
        data-keyboard-open={keyboardOpen ? "" : undefined}
        style={{ "--keyboard-inset": `${keyboardInset}px` } as React.CSSProperties}
      >
        <label className="palChatSr" htmlFor={inputId}>
          {PLAN_FIELD_LABEL}
        </label>
        <input
          id={inputId}
          ref={composerInput}
          className="palChatInput"
          value={query}
          disabled={!inputReady}
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
          disabled={!inputReady || pending || !query.trim()}
          aria-label="Ask"
        >
          <ArrowUp size={20} aria-hidden="true" />
        </button>
      </form>
      </Screen>
    </>
  );
}
