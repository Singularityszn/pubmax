"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { ArrowRight, Check } from "lucide-react";

import type { SignalFamily } from "@/lib/pubPal";

import "./nightSignals.css";

export type NightSignalAssetStatus = "authored-pilot" | "lookdev-fallback";

/** Dormant delivery seam for future character work. It is not rendered. */
export type NightSignalAssetManifest = {
  revision: string;
  status: NightSignalAssetStatus;
  posterSrc: string;
  modelSrc: string | null;
  loopWebmSrc: string | null;
  loopMp4Src: string | null;
  alphaMode: "transparent" | "background-matched";
};

export type NightSignal = {
  id: string;
  family: SignalFamily;
  label: string;
  mood: string;
  description: string;
  accent: string;
  mapHref: string;
  accessibleDescription: string;
  asset: NightSignalAssetManifest;
};

const asset = (id: string): NightSignalAssetManifest => ({
  revision: "paused-lookdev-01",
  status: "lookdev-fallback",
  posterSrc: `/night-signals/${id}.svg`,
  modelSrc: null,
  loopWebmSrc: null,
  loopMp4Src: null,
  alphaMode: "transparent",
});

export const NIGHT_SIGNALS: NightSignal[] = [
  {
    id: "beer-runner",
    family: "beer",
    label: "Beer",
    mood: "Easy first round",
    description: "Good-value pints, familiar pubs and enough energy to keep the night moving.",
    accent: "#dca43d",
    mapHref: "/map?drink=beer&style=balanced",
    accessibleDescription: "Choose a relaxed beer-led night.",
    asset: asset("beer-runner"),
  },
  {
    id: "gin-oracle",
    family: "gin",
    label: "Gin",
    mood: "A sharper evening",
    description: "Smaller rooms, good conversation and places that feel considered without feeling formal.",
    accent: "#86b9a8",
    mapHref: "/map?drink=gin&style=dateNight",
    accessibleDescription: "Choose a considered gin-led night.",
    asset: asset("gin-oracle"),
  },
  {
    id: "rum-navigator",
    family: "rum",
    label: "Rum",
    mood: "Something less obvious",
    description: "Louder flavour, later rooms and a route that is willing to leave the predictable streets.",
    accent: "#c97852",
    mapHref: "/map?drink=rum&style=writerTrail",
    accessibleDescription: "Choose an adventurous rum-led night.",
    asset: asset("rum-navigator"),
  },
  {
    id: "whisky-archivist",
    family: "whisky",
    label: "Whisky",
    mood: "Old rooms, long stories",
    description: "Heritage pubs, quieter corners and the sort of night where one place can hold your attention.",
    accent: "#b9854e",
    mapHref: "/map?drink=whisky&style=heritage",
    accessibleDescription: "Choose a heritage whisky-led night.",
    asset: asset("whisky-archivist"),
  },
  {
    id: "brandy-diplomat",
    family: "brandy",
    label: "Brandy",
    mood: "Slow the pace",
    description: "Comfortable seats, warmer rooms and fewer stops chosen for staying rather than rushing.",
    accent: "#b56f5f",
    mapHref: "/map?style=dateNight",
    accessibleDescription: "Choose a slower brandy-inspired night without changing map drink filters.",
    asset: asset("brandy-diplomat"),
  },
  {
    id: "vodka-signal",
    family: "vodka",
    label: "Vodka",
    mood: "Clean, late, direct",
    description: "A simple route into the busier part of the night, with transport home kept visible.",
    accent: "#8992ad",
    mapHref: "/map?style=balanced",
    accessibleDescription: "Choose a direct vodka-inspired night without changing map drink filters.",
    asset: asset("vodka-signal"),
  },
];

export default function NightSignals() {
  const [active, setActive] = useState(0);
  const [pending, setPending] = useState<SignalFamily | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("pubmax_signal_affinity") as SignalFamily | null;
      const savedIndex = NIGHT_SIGNALS.findIndex((item) => item.family === saved);
      if (savedIndex >= 0) queueMicrotask(() => setActive(savedIndex));
    } catch {
      // Selection is fully usable when storage is unavailable.
    }
  }, []);

  const signal = NIGHT_SIGNALS[active];
  const confirm = () => {
    if (!pending) return;
    try {
      localStorage.setItem("pubmax_signal_affinity", pending);
    } catch {
      // Saving is optional; the selected map route remains available.
    }
    setPending(null);
  };

  return (
    <section
      className="nightSignals"
      id="signals"
      aria-labelledby="signals-title"
      style={{ "--signal-accent": signal.accent } as CSSProperties}
    >
      <header className="nightSignalsIntro">
        <p className="nsKicker">Start with tonight</p>
        <h2 id="signals-title">What are you in the mood for?</h2>
        <p>Choose a direction, not a personality test. PubMax will keep the route grounded in real places, prices and journeys home.</p>
      </header>

      <div className="nightSignalChooser">
        <div className="nightSignalOptions" role="tablist" aria-label="Choose the mood for tonight">
          {NIGHT_SIGNALS.map((item, index) => (
            <button
              id={`night-signal-tab-${item.id}`}
              key={item.id}
              type="button"
              role="tab"
              aria-controls="night-signal-summary"
              aria-selected={active === index}
              className={active === index ? "isActive" : ""}
              onClick={() => {
                setActive(index);
                setPending(item.family);
              }}
            >
              <span className="nightSignalIndex">0{index + 1}</span>
              <span className="nightSignalOptionCopy">
                <strong>{item.label}</strong>
                <small>{item.mood}</small>
              </span>
              <span className="nightSignalCheck" aria-hidden="true">
                {active === index ? <Check size={15} /> : null}
              </span>
            </button>
          ))}
        </div>

        <article
          className="nightSignalSummary"
          id="night-signal-summary"
          role="tabpanel"
          aria-labelledby={`night-signal-tab-${signal.id}`}
        >
          <p>Tonight’s direction</p>
          <div className="nightSignalSummaryHeading">
            <span aria-hidden="true" />
            <h3>{signal.mood}</h3>
          </div>
          <p className="nightSignalSummaryText">{signal.description}</p>
          <div className="nightSignalSummaryActions">
            <Link className="nightSignalPrimary" href={signal.mapHref}>
              Open this map <ArrowRight size={17} />
            </Link>
            <Link className="nightSignalSecondary" href="/pal">Set up a Pub Pal</Link>
          </div>
          <small>Choosing Brandy or Vodka changes this page’s mood only. It does not create a hidden map filter.</small>
        </article>
      </div>

      {pending ? (
        <div className="signalConfirm" role="dialog" aria-label="Save drink preference">
          <div>
            <span>Optional</span>
            <p>Remember {pending} as a drink preference?</p>
          </div>
          <button type="button" onClick={() => setPending(null)}>Not now</button>
          <button type="button" onClick={confirm}>Remember it</button>
        </div>
      ) : null}
    </section>
  );
}
