"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowRight } from "lucide-react";
import type { SignalFamily } from "@/lib/pubPal";
import "./nightSignals.css";

export type NightSignalAssetStatus = "authored-pilot" | "lookdev-fallback";

/**
 * The delivery seam for the final Blender/Houdini character pipeline.
 * Only the active manifest is mounted. Missing production files deliberately
 * resolve to the authored SVG poster rather than a blank WebGL viewport.
 */
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
  name: string;
  mood: string;
  material: string;
  accent: string;
  accessibleDescription: string;
  asset: NightSignalAssetManifest;
};

const asset = (
  id: string,
  status: NightSignalAssetStatus = "lookdev-fallback",
): NightSignalAssetManifest => ({
  revision: status === "authored-pilot" ? "beer-pilot-01" : "lookdev-01",
  status,
  posterSrc: `/night-signals/${id}.svg`,
  // Populated by the production export pipeline. Null is meaningful: the UI
  // shows an authored poster and does not imply a final real-time asset exists.
  modelSrc: null,
  loopWebmSrc: null,
  loopMp4Src: null,
  alphaMode: "transparent",
});

export const NIGHT_SIGNALS: NightSignal[] = [
  {
    id: "beer-runner",
    family: "beer",
    name: "Mara / Runner 01",
    mood: "Carbonated momentum",
    material: "Amber volume / rising microbubbles",
    accent: "#f6ad3c",
    accessibleDescription:
      "A fictional adult synthetic face dissolves at the neck while a translucent hand raises an amber pint. Fine carbonation travels through the face like warm data.",
    asset: asset("beer-runner", "authored-pilot"),
  },
  {
    id: "gin-oracle",
    family: "gin",
    name: "Iona / Oracle 02",
    mood: "Botanical refraction",
    material: "Crystal planes / suspended botanicals",
    accent: "#9effdc",
    accessibleDescription:
      "A fictional adult crystalline face and partial hand hold a stemmed gin glass, with translucent botanical fragments suspended through the portrait.",
    asset: asset("gin-oracle"),
  },
  {
    id: "rum-navigator",
    family: "rum",
    name: "Sol / Navigator 03",
    mood: "Copper after-hours",
    material: "Copper volume / slow smoke ribbons",
    accent: "#e0714a",
    accessibleDescription:
      "A fictional adult holographic face appears from copper ribbons while a partial hand carries a low rum glass toward the mouth.",
    asset: asset("rum-navigator"),
  },
  {
    id: "whisky-archivist",
    family: "whisky",
    name: "Ren / Archivist 04",
    mood: "Faceted midnight",
    material: "Dark glass / restrained warm caustics",
    accent: "#e5a552",
    accessibleDescription:
      "A fictional adult faceted synthetic face studies a whisky tumbler, with warm light moving through dark translucent planes.",
    asset: asset("whisky-archivist"),
  },
  {
    id: "brandy-diplomat",
    family: "brandy",
    name: "Vela / Diplomat 05",
    mood: "Polished ceremony",
    material: "Rose contour / liquid lensing",
    accent: "#f07a70",
    accessibleDescription:
      "A fictional adult polished translucent face raises a rounded brandy glass, with the wrist and neck fading into fine contour lines.",
    asset: asset("brandy-diplomat"),
  },
  {
    id: "vodka-signal",
    family: "vodka",
    name: "Nix / Signal 06",
    mood: "Ice-frequency clarity",
    material: "Ice geometry / controlled interference",
    accent: "#c5ccff",
    accessibleDescription:
      "A fictional adult colourless digital face and partial hand emerge around a chilled vodka glass, interrupted by precise ice-like signal fragments.",
    asset: asset("vodka-signal"),
  },
];

function useReducedMotion() {
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reduced;
}

export function NightSignalStage({ signal }: { signal: NightSignal }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [posterLoaded, setPosterLoaded] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const reducedMotion = useReducedMotion();
  const hasLoop = Boolean(signal.asset.loopWebmSrc || signal.asset.loopMp4Src);
  const showLoop = hasLoop && !reducedMotion;
  const captureCachedPoster = useCallback((node: HTMLImageElement | null) => {
    // An SVG can finish before React hydrates and attaches `onLoad`. The ref
    // callback closes that cache-hit gap without introducing an effect render.
    if (node?.complete && node.naturalWidth > 0) {
      queueMicrotask(() => setPosterLoaded(true));
    }
  }, []);

  const labelId = `night-signal-tab-${signal.id}`;
  const assetLabel =
    signal.asset.status === "authored-pilot"
      ? "Static Beer look-development pilot"
      : "Character look-development fallback";

  return (
    <div
      ref={stageRef}
      id="night-signal-stage"
      className="nightSignalStage"
      role="tabpanel"
      aria-labelledby={labelId}
      aria-label={signal.accessibleDescription}
      data-asset-status={signal.asset.status}
      data-poster-state={posterFailed ? "failed" : posterLoaded ? "ready" : "loading"}
      style={{ "--signal-accent": signal.accent } as CSSProperties}
      onPointerMove={(event) => {
        if (event.pointerType !== "mouse" || !stageRef.current) return;
        const bounds = stageRef.current.getBoundingClientRect();
        const x = (event.clientX - bounds.left) / bounds.width - 0.5;
        const y = (event.clientY - bounds.top) / bounds.height - 0.5;
        stageRef.current.style.setProperty("--signal-x", `${x * 10}px`);
        stageRef.current.style.setProperty("--signal-y", `${y * 7}px`);
      }}
      onPointerLeave={() => {
        stageRef.current?.style.setProperty("--signal-x", "0px");
        stageRef.current?.style.setProperty("--signal-y", "0px");
      }}
    >
      <div className="nightSignalStageHardware" aria-hidden="true">
        <span>PX-SIGNAL / {signal.asset.revision}</span>
        <span>{signal.asset.alphaMode}</span>
      </div>

      {/* This silhouette exists synchronously, before an image request can
          finish. Slow networks and broken assets therefore never produce an
          empty black viewport. */}
      <div className="nightSignalInstantFallback" aria-hidden="true">
        <span className="instantHalo" />
        <span className="instantFace" />
        <span className="instantGlass" />
      </div>

      {showLoop ? (
        <video
          key={signal.id}
          className="nightSignalMedia"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster={signal.asset.posterSrc}
          aria-hidden="true"
        >
          {signal.asset.loopWebmSrc ? (
            <source src={signal.asset.loopWebmSrc} type="video/webm" />
          ) : null}
          {signal.asset.loopMp4Src ? (
            <source src={signal.asset.loopMp4Src} type="video/mp4" />
          ) : null}
        </video>
      ) : (
        <Image
          ref={captureCachedPoster}
          key={signal.id}
          className="nightSignalMedia"
          src={signal.asset.posterSrc}
          alt=""
          aria-hidden="true"
          draggable={false}
          width={800}
          height={940}
          unoptimized
          onLoad={() => setPosterLoaded(true)}
          onError={() => setPosterFailed(true)}
        />
      )}

      <div className="nightSignalStageReadout" aria-hidden="true">
        <span className="stagePulse" />
        <span>{assetLabel}</span>
        <strong>{signal.family.toUpperCase()}</strong>
      </div>
    </div>
  );
}

export default function NightSignals() {
  const [active, setActive] = useState(0);
  const [pending, setPending] = useState<SignalFamily | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("pubmax_signal_affinity") as SignalFamily | null;
      const savedIndex = NIGHT_SIGNALS.findIndex((item) => item.family === saved);
      if (savedIndex >= 0) queueMicrotask(() => setActive(savedIndex));
    } catch {
      // Local storage is optional; selection remains fully usable without it.
    }
  }, []);

  const signal = NIGHT_SIGNALS[active];
  const confirm = () => {
    if (!pending) return;
    try {
      localStorage.setItem("pubmax_signal_affinity", pending);
    } catch {
      // The visual choice still succeeds when preference persistence is denied.
    }
    setPending(null);
  };

  return (
    <section
      className={`nightSignals signalWorld-${signal.family}`}
      id="signals"
      aria-labelledby="signals-title"
      style={{ "--signal-accent": signal.accent } as CSSProperties}
    >
      <div className="nightSignalsAtmosphere" aria-hidden="true" />

      <div className="nightSignalsCopy">
        <p className="nsKicker">
          <span>Night Signal</span>
          <span>0{active + 1} / 06</span>
        </p>
        <h2 id="signals-title">
          Meet the future<br />
          <em>you go out with.</em>
        </h2>
        <p className="nightSignalIdentity">
          <strong>{signal.name}</strong>
          <span>{signal.mood}</span>
        </p>
        <p className="nightSignalIntroduction">
          Six fictional people. Six nightlife frequencies. Choose the atmosphere
          that feels like tonight—then let your map stay grounded in real places,
          prices and journeys.
        </p>
        <dl>
          <div>
            <dt>Material study</dt>
            <dd>{signal.material}</dd>
          </div>
          <div>
            <dt>Production state</dt>
            <dd>
              {signal.asset.status === "authored-pilot"
                ? "Static look-development pilot"
                : "Authored look development"}
            </dd>
          </div>
        </dl>
        <Link href="/pal" className="nightSignalPalLink">
          <span>Meet your Pub Pal</span>
          <i aria-hidden="true">
            <ArrowRight size={16} strokeWidth={1.5} />
          </i>
        </Link>
      </div>

      <NightSignalStage key={signal.id} signal={signal} />

      <div className="nightSignalRailWrap">
        <p>Choose a frequency</p>
        <div className="nightSignalRail" role="tablist" aria-label="Night Signal characters">
          {NIGHT_SIGNALS.map((item, index) => (
            <button
              id={`night-signal-tab-${item.id}`}
              type="button"
              role="tab"
              aria-controls="night-signal-stage"
              aria-selected={active === index}
              tabIndex={active === index ? 0 : -1}
              className={active === index ? "isActive" : ""}
              key={item.id}
              onClick={() => {
                setActive(index);
                setPending(item.family);
              }}
            >
              <span>0{index + 1}</span>
              <strong>{item.family}</strong>
              <small>{item.mood}</small>
            </button>
          ))}
        </div>
      </div>

      {pending ? (
        <div className="signalConfirm" role="dialog" aria-label="Save drink preference">
          <div>
            <span>Optional preference</span>
            <p>Use {pending} when PubMax suggests drinks?</p>
          </div>
          <button type="button" onClick={() => setPending(null)}>
            Visual only
          </button>
          <button type="button" onClick={confirm}>
            Save preference
          </button>
        </div>
      ) : null}
    </section>
  );
}
