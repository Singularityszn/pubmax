"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, LockKeyhole, Mic, Sparkles, Trash2 } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import SignInButton from "@/components/auth/SignInButton";
import { DEFAULT_PAL_DRAFT, PAL_SPECIES, PAL_UNLOCKS, PAL_VOICES, SIGNAL_FAMILIES, type PubPal, type PubPalDraft } from "@/lib/pubPal";
import { PubPalAvatar, signalLabel } from "./PubPalAvatar";
import PubPalVoice from "./PubPalVoice";
import { authedFetch } from "@/lib/authedFetch";

const STORAGE_KEY = "pubmax_pub_pal_v1";

function readPal(ownerId: string): PubPal | null {
  try { const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as PubPal | null; return raw?.ownerId === ownerId ? raw : null; } catch { return null; }
}

export default function PubPalHome() {
  const { user, loading, configured } = useAuth();
  const [pal, setPal] = useState<PubPal | null>(null);
  const [draft, setDraft] = useState<PubPalDraft>(DEFAULT_PAL_DRAFT);
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!user) { queueMicrotask(() => { setPal(null); setReady(true); }); return; }
    void authedFetch("/api/pub-pal").then(async response => {
      const body = await response.json().catch(() => ({})) as { pal?: PubPal | null };
      const next = response.ok ? body.pal ?? null : readPal(user.id);
      if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setPal(next); setReady(true);
    }).catch(() => { setPal(readPal(user.id)); setReady(true); });
  }, [user]);
  const level = useMemo(() => Math.floor((pal?.masteryPoints ?? 0) / 50) + 1, [pal]);

  if (loading || !ready) return <main className="palPage"><div className="palSkeleton" aria-label="Loading your Pub Pal" /></main>;
  if (!user) return <main className="palPage palGate"><div><p className="palKicker">PRIVATE COMPANION / 18+</p><h1>Your night deserves<br />a familiar.</h1><p>Create an account to own, sync and control a Pub Pal. PubMax stores only memories you approve.</p><div className="palGateActions">{configured ? <SignInButton /> : <p className="palNotice">Account sign-in needs Supabase configuration. The rest of PubMax remains available.</p>}<Link href="/map">Continue without a Pal</Link></div></div><PubPalAvatar appearance={DEFAULT_PAL_DRAFT.appearance} name="Unclaimed Pub Pal" /></main>;

  if (!pal) {
    const create = async () => {
      const response = await authedFetch("/api/pub-pal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });
      const body = await response.json().catch(() => ({})) as { pal?: PubPal };
      if (!response.ok || !body.pal) return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(body.pal)); setPal(body.pal);
    };
    return <main className="palPage palOnboarding"><div className="palOnboardVisual"><PubPalAvatar appearance={draft.appearance} name={draft.name || "Your future Pub Pal"} /><p>{step + 1} / 5</p></div><section className="palOnboardPanel" aria-live="polite">
      {step === 0 && <><p className="palKicker">ELIGIBILITY</p><h1>First, the grown-up bit.</h1><label className="palCheck"><input type="checkbox" checked={draft.adultConfirmed} onChange={(e) => setDraft({ ...draft, adultConfirmed: e.target.checked })} /><span>I confirm that I am 18 or over.</span></label><p className="palFine">We store the confirmation time, not your date of birth. Your Pal never rewards alcohol quantity.</p></>}
      {step === 1 && <><p className="palKicker">FORM</p><h1>Choose your familiar.</h1><div className="palChoices">{PAL_SPECIES.map(species => <button className={draft.appearance.species === species ? "isSelected" : ""} key={species} onClick={() => setDraft({ ...draft, appearance: { ...draft.appearance, species } })}><span>{species}</span><small>{species === "hound" ? "loyal / kinetic" : species === "raven" ? "observant / dry" : "curious / quick"}</small></button>)}</div></>}
      {step === 2 && <><p className="palKicker">IDENTITY</p><h1>Name the signal.</h1><label className="palField"><span>Name</span><input value={draft.name} maxLength={32} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Morrow" autoFocus /></label><p className="palLabel">Initial affinity</p><div className="signalChoices">{SIGNAL_FAMILIES.map(signal => <button className={draft.appearance.signalAffinity === signal ? "isSelected" : ""} key={signal} onClick={() => setDraft({ ...draft, appearance: { ...draft.appearance, signalAffinity: signal } })}>{signalLabel(signal)}</button>)}</div></>}
      {step === 3 && <><p className="palKicker">PERSONALITY</p><h1>Set the chemistry.</h1>{[["Playful", "playfulness"], ["Energetic", "energy"], ["Storyteller", "storytelling"]].map(([label, key]) => <label className="palRange" key={key}><span>{label}</span><input type="range" min="0" max="100" value={draft.personality[key as keyof Omit<typeof draft.personality,"relationship">]} onChange={(e) => setDraft({ ...draft, personality: { ...draft.personality, [key]: Number(e.target.value) } })} /></label>)}<div className="signalChoices">{(["guide","sidekick","confidant"] as const).map(relationship => <button className={draft.personality.relationship === relationship ? "isSelected" : ""} key={relationship} onClick={() => setDraft({ ...draft, personality: { ...draft.personality, relationship } })}>{relationship}</button>)}</div></>}
      {step === 4 && <><p className="palKicker">VOICE & PRIVACY</p><h1>Choose how it speaks.</h1><div className="palChoices">{PAL_VOICES.map(voice => <button className={draft.voice.id === voice ? "isSelected" : ""} key={voice} onClick={() => setDraft({ ...draft, voice: { ...draft.voice, id: voice } })}><Mic size={17}/><span>{voice}</span><small>{voice === "ember" ? "warm / grounded" : voice === "velvet" ? "calm / nocturnal" : "bright / synthetic"}</small></button>)}</div><div className="privacyNote"><LockKeyhole size={18}/><p>Audio and transcripts are not PubMax memories. After a chat, you approve each structured fact before it is saved.</p></div></>}
      <div className="palOnboardActions"><button disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button>{step < 4 ? <button className="palPrimary" disabled={(step === 0 && !draft.adultConfirmed) || (step === 2 && !draft.name.trim())} onClick={() => setStep(step + 1)}>Continue <ArrowRight size={17}/></button> : <button className="palPrimary" onClick={create}>Create my Pal <Sparkles size={17}/></button>}</div>
    </section></main>;
  }

  const remove = async () => { if (!confirm("Delete this Pub Pal and every confirmed memory?")) return; const response = await authedFetch("/api/pub-pal", { method: "DELETE" }); if (!response.ok) return; localStorage.removeItem(STORAGE_KEY); setPal(null); setStep(0); setDraft(DEFAULT_PAL_DRAFT); };
  return <main className="palPage palHome"><section className="palHero"><div><p className="palKicker">PAL / LEVEL {level}</p><h1>{pal.name}</h1><p>Your {signalLabel(pal.appearance.signalAffinity)}-frequency {pal.appearance.species}. Planning quality never depends on level.</p><div className="mastery"><span style={{ width: `${(pal.masteryPoints % 50) * 2}%` }} /><p>{pal.masteryPoints % 50} / 50 to next signal</p></div><div className="palHeroActions"><Link href="/plan">Plan with {pal.name}<ArrowRight size={17}/></Link></div><PubPalVoice /></div><PubPalAvatar appearance={pal.appearance} name={pal.name} /></section><section className="palDashboard"><article><p className="palKicker">MEMORY</p><h2>Nothing hidden.</h2><p>Only facts you explicitly approve appear here. Voice transcripts and audio are not retained.</p><button disabled>No confirmed memories</button></article><article><p className="palKicker">MASTERY</p><h2>Learn the city together.</h2><div className="unlockList">{PAL_UNLOCKS.map(unlock => <div key={unlock.id} className={pal.masteryPoints >= unlock.pointsRequired ? "isUnlocked" : ""}><span>{unlock.pointsRequired}</span><p>{unlock.label}</p><small>{unlock.category.replace("_", " ")}</small></div>)}</div></article><article><p className="palKicker">CONTROL</p><h2>Your Pal, your boundaries.</h2><button onClick={() => { const next = { ...pal, muted: !pal.muted, updatedAt: new Date().toISOString() }; localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); setPal(next); }}>{pal.muted ? "Unmute Pal" : "Mute Pal"}</button><button className="danger" onClick={remove}><Trash2 size={16}/> Delete Pal</button></article></section></main>;
}
