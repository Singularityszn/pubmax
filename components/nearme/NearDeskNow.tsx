"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LocateFixed, RotateCw } from "lucide-react";

import { trackEvent } from "@/lib/analytics";
import {
  deskAnswerHeadline,
  deskEmptyLine,
  deskLoadFailedLine,
  rankDeskNearMe,
  type DeskAnswer,
  type DeskCard,
} from "@/lib/nearDesk";
import { loadDeskVenues, type DeskVenueLoad } from "@/lib/nearDeskVenues";
import {
  CENTRAL_PATCH,
  NIGHT_PATCHES,
  readRememberedArea,
  resolveNightPatch,
  writeRememberedArea,
  type NightPatch,
} from "@/lib/nightPatches";
import {
  shouldResolveInitialNearPatch,
  shouldStartNearAutoLocate,
} from "@/components/nearme/NearMeNow";

import "./nearMeNow.css";
import "./nearDeskNow.css";

type LocateState = "idle" | "requesting" | "ready" | "denied" | "unavailable";
type PatchReason = "denied" | "unavailable" | "none" | null;

const GEO_OPTS: PositionOptions = { enableHighAccuracy: false, timeout: 7000, maximumAge: 60_000 };

function deskIntroLede(): string {
  return "Somewhere to sit and work near you.";
}

function DeskFacts({ card, hero }: { card: DeskCard; hero?: boolean }) {
  return (
    <>
      <ul className="ndnFacts">
        <li>{card.wifiCaption}</li>
        <li>{card.laptopCaption}</li>
        <li>{card.hoursCaption}</li>
        <li>{card.seatDataLine}</li>
      </ul>
      <p className={hero ? "ndnChecked" : "ndnCardFact"}>{card.checkedCaption}</p>
    </>
  );
}

function DeskHero({ card }: { card: DeskCard }) {
  const walk = typeof card.walkMinutes === "number"
    ? `${card.walkMinutes} min walk`
    : null;
  return (
    <article className="ndnHero">
      <p className="ndnKind">{card.kindLabel}</p>
      <h3 className="ndnHeroName">{card.name}</h3>
      {card.address ? <p className="ndnCardFact">{card.address}</p> : null}
      {walk ? <p className="ndnCardFact">{walk}</p> : null}
      <DeskFacts card={card} hero />
    </article>
  );
}

function DeskCardList({ cards }: { cards: DeskCard[] }) {
  const rest = cards.slice(1);
  if (rest.length === 0) return null;
  return (
    <ol className="nmnList" aria-label="More desks nearby">
      {rest.map((card) => (
        <li key={card.id}>
          <article className="ndnCard">
            <p className="ndnKind">{card.kindLabel}</p>
            <p className="ndnCardName">{card.name}</p>
            {card.address ? <p className="ndnCardFact">{card.address}</p> : null}
            {typeof card.walkMinutes === "number" ? (
              <p className="ndnCardFact">{card.walkMinutes} min walk</p>
            ) : null}
            <DeskFacts card={card} />
          </article>
        </li>
      ))}
    </ol>
  );
}

export default function NearDeskNow({
  autoLocate = false,
  initialPatchId = null,
  syncPatchToUrl = false,
}: {
  autoLocate?: boolean;
  initialPatchId?: string | null;
  syncPatchToUrl?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const bootPatch = resolveNightPatch(initialPatchId);
  const [state, setState] = useState<LocateState>("idle");
  const [answer, setAnswer] = useState<DeskAnswer | null>(null);
  const [packStatus, setPackStatus] = useState<DeskVenueLoad["status"] | null>(null);
  const [patch, setPatch] = useState<NightPatch | null>(null);
  const [patchReason, setPatchReason] = useState<PatchReason>(null);
  const packRef = useRef<DeskVenueLoad | null>(null);
  const loadingRef = useRef<Promise<DeskVenueLoad> | null>(null);
  const answerGenerationRef = useRef(0);
  const autoLocateStartedRef = useRef(false);
  const lastTrackedAnswerRef = useRef(0);

  const beginAnswer = useCallback(() => ++answerGenerationRef.current, []);

  const loadPack = useCallback(async (): Promise<DeskVenueLoad> => {
    if (packRef.current) return packRef.current;
    if (!loadingRef.current) {
      loadingRef.current = loadDeskVenues().then((loaded) => {
        packRef.current = loaded;
        return loaded;
      });
    }
    return loadingRef.current;
  }, []);

  const applyAnswer = useCallback((
    generation: number,
    loaded: DeskVenueLoad,
    next: DeskAnswer,
    nextPatch: NightPatch | null,
    reason: PatchReason,
  ) => {
    if (generation !== answerGenerationRef.current) return;
    setPackStatus(loaded.status);
    setAnswer(next);
    setPatch(nextPatch);
    if (reason !== null) setPatchReason(reason);
    setState("ready");
    if (lastTrackedAnswerRef.current !== generation && loaded.status === "ready") {
      lastTrackedAnswerRef.current = generation;
      trackEvent("desk_answer_served", {
        outcome: next.cards.length > 0 ? "answer" : "thin",
      });
    }
  }, []);

  const pickPatch = useCallback((
    next: NightPatch,
    reason: PatchReason = null,
  ) => {
    const generation = beginAnswer();
    setState("requesting");
    setPatch(next);
    void loadPack().then((loaded) => {
      if (generation !== answerGenerationRef.current) return;
      if (loaded.status === "failed") {
        applyAnswer(generation, loaded, {
          hero: null,
          cards: [],
          scope: "none",
          radiusKm: 0,
        }, next, reason);
        return;
      }
      const ranked = rankDeskNearMe(next.lat, next.lng, loaded.venues, {
        observedAt: loaded.observedAt,
      });
      applyAnswer(generation, loaded, ranked, next, reason);
      writeRememberedArea({ kind: "patch", id: next.id });
      if (syncPatchToUrl && pathname) {
        try {
          const params = new URLSearchParams(
            typeof window !== "undefined" ? window.location.search : "",
          );
          params.set("patch", next.id);
          const query = params.toString();
          router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
        } catch {
          // URL sync is best-effort.
        }
      }
    });
  }, [applyAnswer, beginAnswer, loadPack, pathname, router, syncPatchToUrl]);

  const answerWithoutFix = useCallback((reason: Exclude<PatchReason, null>) => {
    const remembered = readRememberedArea();
    const rememberedPatch =
      remembered?.kind === "patch" ? resolveNightPatch(remembered.id) : null;
    pickPatch(rememberedPatch ?? CENTRAL_PATCH, reason);
  }, [pickPatch]);

  const locate = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState("unavailable");
      answerWithoutFix("unavailable");
      return;
    }
    const generation = beginAnswer();
    setState("requesting");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void loadPack().then((loaded) => {
          if (generation !== answerGenerationRef.current) return;
          if (loaded.status === "failed") {
            applyAnswer(generation, loaded, {
              hero: null,
              cards: [],
              scope: "none",
              radiusKm: 0,
            }, null, null);
            return;
          }
          const ranked = rankDeskNearMe(
            position.coords.latitude,
            position.coords.longitude,
            loaded.venues,
            { observedAt: loaded.observedAt },
          );
          applyAnswer(generation, loaded, ranked, null, null);
        });
      },
      (error) => {
        if (generation !== answerGenerationRef.current) return;
        const reason = error.code === error.PERMISSION_DENIED ? "denied" : "unavailable";
        setState(reason);
        answerWithoutFix(reason);
      },
      GEO_OPTS,
    );
  }, [answerWithoutFix, applyAnswer, beginAnswer, loadPack]);

  useEffect(() => {
    const startAutoLocate = shouldStartNearAutoLocate({
      autoLocate,
      alreadyStarted: autoLocateStartedRef.current,
      hasInitialLocation: false,
      bootPatchId: bootPatch?.id ?? null,
    });
    if (bootPatch) {
      if (shouldResolveInitialNearPatch(bootPatch.id, patch?.id)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        pickPatch(bootPatch, null);
      }
      return;
    }
    if (!startAutoLocate) return;
    autoLocateStartedRef.current = true;
    locate();
    // Mount-only: loadPack/locate/pickPatch stay stable for a given visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLocate, bootPatch?.id]);

  const areaLabel = patch?.label ?? null;
  const headline = deskAnswerHeadline({
    scope: answer?.scope ?? "none",
    patchLabel: areaLabel,
  });
  const patchMessage = areaLabel && patchReason
    ? patchReason === "denied"
      ? `Location's off, so here's ${areaLabel}.`
      : patchReason === "none"
        ? `Nothing logged within reach, so here's ${areaLabel}.`
        : `No location on this device, so here's ${areaLabel}.`
    : null;

  return (
    <section className="nmn" aria-label="Find a desk nearby">
      {state === "idle" ? (
        <div className="nmnIntro">
          <h1 className="nmnLede">{deskIntroLede()}</h1>
          <button type="button" className="nmnLocate" onClick={locate}>
            <LocateFixed size={18} aria-hidden="true" /> Find a desk
          </button>
          <p className="nmnHint">We only use your location to rank desks nearby. Nothing is stored.</p>
          <div className="nmnQuickPatches">
            <p className="nmnQuickPatchesLabel">Or pick a patch</p>
            <ul className="nmnAreaChips" aria-label="Pick an area">
              {NIGHT_PATCHES.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    className="nmnBoroughChip"
                    onClick={() => pickPatch(entry)}
                  >
                    {entry.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {state === "requesting" ? (
        <div className="nmnStatus" role="status">
          <span className="nmnSpinner" aria-hidden="true" />
          {patch
            ? `Checking desks around ${patch.label}…`
            : "Checking desks near you…"}
        </div>
      ) : null}

      {state === "denied" || state === "unavailable" ? (
        <div className="nmnStatus" role="status">
          <span className="nmnSpinner" aria-hidden="true" />
          Checking desks in town…
        </div>
      ) : null}

      {state === "ready" && packStatus === "failed" ? (
        <p className="ndnEmpty" role="status">{deskLoadFailedLine()}</p>
      ) : null}

      {state === "ready" && packStatus === "ready" && answer && answer.cards.length === 0 ? (
        <div className="nmnHead">
          <h2>{deskEmptyLine()}</h2>
          {patchMessage ? <p className="nmnSub">{patchMessage}</p> : null}
          <div className="nmnQuickPatches">
            <ul className="nmnAreaChips" aria-label="Pick an area">
              {NIGHT_PATCHES.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    className="nmnBoroughChip"
                    data-active={patch?.id === entry.id ? "" : undefined}
                    onClick={() => pickPatch(entry)}
                  >
                    {entry.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {state === "ready" && packStatus === "ready" && answer && answer.hero ? (
        <>
          <header className="nmnHead">
            <h2>{headline}</h2>
            {patchMessage ? <p className="nmnSub">{patchMessage}</p> : null}
            {answer.scope === "widened" ? (
              <p className="nmnWiden">Not many desks on your doorstep. These are a bit further out.</p>
            ) : (
              <p className="nmnSub">Within about a 12-minute walk.</p>
            )}
          </header>
          <DeskHero card={answer.hero} />
          <DeskCardList cards={answer.cards} />
          <footer className="nmnFoot">
            <button type="button" className="nmnRetry nmnRetryGhost" onClick={locate}>
              <RotateCw size={15} aria-hidden="true" /> Update location
            </button>
          </footer>
        </>
      ) : null}
    </section>
  );
}
