"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { SignalFamily } from "@/lib/pubPal";
import "./nightSignals.css";

export type NightSignal = {
  id: string;
  family: SignalFamily;
  name: string;
  mood: string;
  material: string;
  accessibleDescription: string;
};

export const NIGHT_SIGNALS: NightSignal[] = [
  { id: "beer-runner", family: "beer", name: "Runner 01", mood: "Carbonated momentum", material: "Amber data particles", accessibleDescription: "A fictional translucent adult face and hand lift an amber beer while its edges disperse into data particles." },
  { id: "gin-oracle", family: "gin", name: "Oracle 02", mood: "Botanical refraction", material: "Crystal and botanical fragments", accessibleDescription: "A crystalline synthetic adult face holds a gin glass among floating botanical fragments." },
  { id: "rum-navigator", family: "rum", name: "Navigator 03", mood: "Copper after-hours", material: "Slow copper smoke ribbons", accessibleDescription: "A copper holographic adult face carries a rum glass through slow signal ribbons." },
  { id: "whisky-archivist", family: "whisky", name: "Archivist 04", mood: "Faceted midnight", material: "Dark glass and warm caustics", accessibleDescription: "A faceted synthetic adult face studies a whisky glass lit by restrained warm caustics." },
  { id: "brandy-diplomat", family: "brandy", name: "Diplomat 05", mood: "Polished ceremony", material: "Translucent contour fields", accessibleDescription: "A polished translucent adult face raises a rounded brandy glass with deliberate movement." },
  { id: "vodka-signal", family: "vodka", name: "Signal 06", mood: "Ice-frequency clarity", material: "Ice geometry and interference", accessibleDescription: "A colourless digital adult face and hand flicker around a chilled vodka glass." },
];

function SignalFigure({ signal }: { signal: NightSignal }) {
  const ref = useRef<HTMLDivElement>(null);
  return <div ref={ref} className={`nightSignalFigure signal-${signal.family}`} role="img" aria-label={signal.accessibleDescription} onPointerMove={(event) => { const box = ref.current?.getBoundingClientRect(); if (!box || !ref.current) return; ref.current.style.setProperty("--rx", `${((event.clientY-box.top)/box.height-.5)*-8}deg`); ref.current.style.setProperty("--ry", `${((event.clientX-box.left)/box.width-.5)*10}deg`); }} onPointerLeave={() => { ref.current?.style.setProperty("--rx", "0deg"); ref.current?.style.setProperty("--ry", "0deg"); }}><span className="nsOrbit"/><span className="nsFace"><i className="nsEye left"/><i className="nsEye right"/><i className="nsNose"/><i className="nsMouth"/><b className="nsScan"/></span><span className="nsGlass"><i/><b/></span><span className="nsHand"><i/><i/><i/></span><span className="nsDissolve">{Array.from({ length: 14 }, (_, index) => <i key={index} style={{ "--i": index } as React.CSSProperties}/>)}</span></div>;
}

export default function NightSignals() {
  const [active, setActive] = useState(0);
  const [pending, setPending] = useState<SignalFamily | null>(null);
  useEffect(() => { try { const saved = localStorage.getItem("pubmax_signal_affinity") as SignalFamily | null; const index = NIGHT_SIGNALS.findIndex(item => item.family === saved); if (index >= 0) queueMicrotask(() => setActive(index)); } catch {} }, []);
  const signal = NIGHT_SIGNALS[active];
  const confirm = () => { if (!pending) return; try { localStorage.setItem("pubmax_signal_affinity", pending); } catch {} setPending(null); };
  return <section className={`nightSignals signalWorld-${signal.family}`} id="signals" aria-labelledby="signals-title"><div className="nightSignalsCopy"><p className="nsKicker">NIGHT SIGNAL / 0{active + 1}</p><h2 id="signals-title">Choose your<br/><em>frequency.</em></h2><p>{signal.name} — {signal.mood}. Characters shape the atmosphere; your map remains grounded in real places and prices.</p><dl><div><dt>Material</dt><dd>{signal.material}</dd></div><div><dt>State</dt><dd>Live / responsive</dd></div></dl><Link href="/pal">Meet your Pub Pal <ArrowRight size={17}/></Link></div><SignalFigure signal={signal}/><div className="nightSignalRail" role="tablist" aria-label="Night Signal characters">{NIGHT_SIGNALS.map((item,index) => <button role="tab" aria-selected={active === index} className={active === index ? "isActive" : ""} key={item.id} onClick={() => { setActive(index); setPending(item.family); }}><span>0{index + 1}</span><strong>{item.family}</strong><small>{item.mood}</small></button>)}</div>{pending && <div className="signalConfirm" role="dialog" aria-label="Save drink preference"><p>Use {pending} as a planning preference too?</p><button onClick={() => setPending(null)}>Not now</button><button onClick={confirm}>Save preference</button></div>}</section>;
}
