"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, MapPinned, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import styles from "@/app/onboarding/Onboarding.module.css";
import PalPortrait from "@/components/pal/PalPortrait";
import { trackEvent } from "@/lib/analytics";
import { writePreferredCity } from "@/lib/cityPreference";
import {
  FIRST_RUN_COMPANIONS,
  claimTourPromptBudget,
  markTourSeen,
  readFirstRunCompanion,
  releaseTourPromptBudget,
  writeFirstRunCompanion,
  type FirstRunCompanion,
} from "@/lib/firstRunTour";
import { DEFAULT_PAL_DRAFT } from "@/lib/pubPal";

type ReviewedArea = {
  name: string;
  transportAnchor: string;
};

export default function FirstRunOnboarding({
  reviewedAreas,
}: {
  reviewedAreas: ReviewedArea[];
}) {
  const router = useRouter();
  const [stage, setStage] = useState<"london" | "companion">("london");
  const [companion, setCompanion] = useState<FirstRunCompanion>("robin");

  useEffect(() => {
    claimTourPromptBudget();
    const remembered = readFirstRunCompanion();
    if (remembered) void Promise.resolve().then(() => setCompanion(remembered));
    const releaseBudget = () => releaseTourPromptBudget();
    window.addEventListener("pagehide", releaseBudget);
    return () => {
      window.removeEventListener("pagehide", releaseBudget);
      releaseBudget();
    };
  }, []);

  const selectedCompanion = useMemo(
    () => FIRST_RUN_COMPANIONS.find((choice) => choice.id === companion) ?? null,
    [companion],
  );
  const appearance = useMemo(
    () => ({
      ...DEFAULT_PAL_DRAFT.appearance,
      species: companion ?? DEFAULT_PAL_DRAFT.appearance.species,
    }),
    [companion],
  );

  function confirmLondon() {
    writePreferredCity("london");
    setStage("companion");
  }

  function chooseCompanion(choice: FirstRunCompanion) {
    setCompanion(choice);
    writeFirstRunCompanion(choice);
  }

  function skipOnboarding() {
    markTourSeen();
    trackEvent("tour_complete", { completed: false });
    releaseTourPromptBudget();
    router.replace("/tonight");
  }

  function startPlan() {
    if (!companion) return;
    writePreferredCity("london");
    writeFirstRunCompanion(companion);
    markTourSeen();
    trackEvent("tour_complete", { completed: true });
    // Onboarding and push never overlap. The route generator is the first
    // action allowed to arm the native permission explainer.
    releaseTourPromptBudget();
    router.push("/map?plan=1");
  }

  const isCompanionStage = stage === "companion";

  return (
    <main
      id="main"
      // The one screen with no price to add: compose stands down here rather
      // than parking a round + over the reviewed-area list
      // (components/nav/createFab.css).
      className={`${styles.firstRunOnboarding} pageHidesCreateFab`}
      data-stage={stage}
    >
      <header className={styles.firstRunTopbar}>
        <div className={styles.firstRunBrand} aria-label="PUBMAXXING">
          <Image src="/brand/icon.svg" alt="" width={30} height={30} priority />
          <span>PUBMAXXING</span>
        </div>
        <div
          className={styles.firstRunProgress}
          role="progressbar"
          aria-label="Onboarding progress"
          aria-valuemin={1}
          aria-valuemax={2}
          aria-valuenow={isCompanionStage ? 2 : 1}
        >
          <span className={isCompanionStage ? styles.isComplete : styles.isCurrent} />
          <span className={isCompanionStage ? styles.isCurrent : undefined} />
        </div>
        <button type="button" className={`${styles.firstRunSkip} pressable`} onClick={skipOnboarding}>
          Skip
        </button>
      </header>

      <div className={styles.firstRunStage} key={stage}>
        <section className={styles.firstRunVisual} aria-label={isCompanionStage ? "Companion preview" : "London preview"}>
          {isCompanionStage ? (
            <div className={styles.firstRunCompanionHero}>
              <PalPortrait
                appearance={appearance}
                name={selectedCompanion?.label ?? "Companion preview"}
                state="noticing"
              />
              <p aria-live="polite">
                {selectedCompanion
                  ? `${selectedCompanion.label} will be in your corner for the first night.`
                  : "Pick the Pal you want in your corner for the first night."}
              </p>
            </div>
          ) : (
            <figure className={styles.firstRunLondonPhoto}>
              <Image
                src="/landing/hero-thames.jpg"
                alt="London and the Thames viewed from above"
                fill
                priority
                sizes="(max-width: 760px) 100vw, 52vw"
              />
              <figcaption>London, with the route home kept in view.</figcaption>
            </figure>
          )}
        </section>

        <section className={styles.firstRunPanel} aria-live="polite">
          <div className={styles.firstRunPanelInner}>
            {isCompanionStage ? (
              <>
                <p className={styles.firstRunEyebrow}>Your companion</p>
                <h1>Pick your Pub Pal.</h1>
                <p className={styles.firstRunLead}>
                  Every Pal reads the same real prices and routes. Pick the one you want in your corner tonight.
                </p>

                <div className={styles.firstRunCompanionGrid} role="group" aria-label="Choose your Pub Pal">
                  {FIRST_RUN_COMPANIONS.map((choice) => {
                    const selected = companion === choice.id;
                    return (
                      <button
                        key={choice.id}
                        type="button"
                        className={`${styles.firstRunCompanionChoice} pressable${selected ? ` ${styles.isSelected}` : ""}`}
                        aria-pressed={selected}
                        onClick={() => chooseCompanion(choice.id)}
                      >
                        <span>{choice.label}</span>
                        <small>{choice.note}</small>
                        {selected ? <Check size={18} aria-hidden="true" /> : null}
                      </button>
                    );
                  })}
                </div>

                <p className={styles.firstRunPrivacy}>
                  <ShieldCheck size={16} aria-hidden="true" />
                  You can name, tweak, or skip your Pal later.
                </p>

                <div className={styles.firstRunActions}>
                  <button type="button" className={`${styles.firstRunBack} pressable`} onClick={() => setStage("london")}>
                    <ArrowLeft size={18} aria-hidden="true" /> Back
                  </button>
                  <button
                    type="button"
                    className={`${styles.firstRunPrimary} pressable`}
                    disabled={!companion}
                    onClick={startPlan}
                  >
                    Plan my night <ArrowRight size={18} aria-hidden="true" />
                  </button>
                </div>
                <p className={styles.firstRunPermissionNote}>
                  We won&rsquo;t ask about notifications until your first night&rsquo;s sorted.
                </p>
              </>
            ) : (
              <>
                <p className={styles.firstRunEyebrow}>Your city</p>
                <h1>London is ready.</h1>
                <p className={styles.firstRunLead}>
                  Start with checked routes, listed pint prices, and a clear way home.
                </p>

                <div className={styles.firstRunAreaList} aria-label="Reviewed London route areas">
                  {reviewedAreas.map((area) => (
                    <article key={area.name}>
                      <MapPinned size={19} aria-hidden="true" />
                      {/* The stamp rides INSIDE the text block, so a short
                          phone can fold it onto the way-home line
                          (app/onboarding/Onboarding.module.css, the short phone). */}
                      <div>
                        <strong>{area.name}</strong>
                        <span>Home via {area.transportAnchor}</span>
                        <small>PUBMAXX reviewed</small>
                      </div>
                    </article>
                  ))}
                </div>

                <div className={`${styles.firstRunActions} ${styles.firstRunActionsSingle}`}>
                  <button type="button" className={`${styles.firstRunPrimary} pressable`} onClick={confirmLondon}>
                    Use London <ArrowRight size={18} aria-hidden="true" />
                  </button>
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
