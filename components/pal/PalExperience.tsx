"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  LockKeyhole,
  Mic,
  ShieldCheck,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import SignInButton from "@/components/auth/SignInButton";
import { authedFetch } from "@/lib/authedFetch";
import {
  DEFAULT_PAL_DRAFT,
  clearPalOnboardingDraft,
  PAL_UNLOCKS,
  PAL_ONBOARDING_SPECIES,
  PAL_VOICES,
  SIGNAL_FAMILIES,
  readPalOnboardingDraft,
  writePalOnboardingDraft,
  type PalAnimationState,
  type PalOnboardingPrivacy,
  type PubPal,
  type PubPalAppearance,
  type PubPalDraft,
  type PubPalPersonality,
  type PubPalMemory,
} from "@/lib/pubPal";
import PalPortrait from "./PalPortrait";
import PubPalVoice from "@/components/pubpal/PubPalVoice";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "pubmax_pub_pal_v1";
const PRIVACY_KEY = "pubmax_pub_pal_privacy_v1";

const speciesCopy = {
  hound: { title: "Hound", note: "Loyal · energetic" },
  raven: { title: "Raven", note: "Observant · dry" },
  fox: { title: "Fox", note: "Curious · quick" },
  cat: { title: "Cat", note: "Calm · mischievous" },
  rabbit: { title: "Rabbit", note: "Alert · spontaneous" },
  turtle: { title: "Turtle", note: "Steady · thoughtful" },
  squirrel: { title: "Squirrel", note: "Social · excitable" },
  bot: { title: "Night bot", note: "Precise · expressive" },
} as const;

const nameIdeas = {
  "Gen Z": ["Miso", "Nova", "Pixel", "Chilli"],
  "Gen X": ["Ripley", "Bowie", "Gizmo", "Trinity"],
  Classic: ["Mabel", "Teddy", "Bonnie", "Arthur"],
} as const;

const voiceCopy = {
  ember: "Warm and grounded",
  velvet: "Calm and nocturnal",
  signal: "Bright and synthetic",
} as const;

const signalCopy = {
  beer: "Amber",
  gin: "Crystal",
  rum: "Copper",
  whisky: "Faceted",
  brandy: "Polished",
  vodka: "Ice",
} as const;

const materialCopy: Record<PubPalAppearance["material"], string> = {
  hologram: "Hologram",
  chrome: "Chrome",
  glass: "Glass",
};

const accessoryCopy: Record<PubPalAppearance["accessory"], string> = {
  none: "None",
  collar: "Signal collar",
  monocle: "Data lens",
  "signal-ring": "Signal ring",
};

const relationshipCopy: Record<PubPalPersonality["relationship"], string> = {
  guide: "Guide",
  sidekick: "Sidekick",
  confidant: "Confidant",
};

type PrivacyState = PalOnboardingPrivacy;

const DEFAULT_PRIVACY: PrivacyState = {
  proposeMemories: false,
  visible: true,
  muted: false,
};

function previewSpeech(step: number, draft: PubPalDraft): string {
  switch (step) {
    case 0: return "I am for adults planning a night out.";
    case 1: return draft.name.trim() ? `${draft.name.trim()}. I like it.` : `A ${draft.appearance.species}. Give me a name.`;
    case 2: return `${materialCopy[draft.appearance.material]} tuned to ${signalCopy[draft.appearance.signalAffinity].toLowerCase()}.`;
    case 3: return `${voiceCopy[draft.voice.id]}. Your ${relationshipCopy[draft.personality.relationship].toLowerCase()}.`;
    default: return "Nothing becomes memory unless you approve it.";
  }
}

function readStoredPal(ownerId: string): PubPal | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as PubPal | null;
    return value?.ownerId === ownerId ? value : null;
  } catch {
    return null;
  }
}

function ChoiceButton({
  selected,
  title,
  note,
  onClick,
}: {
  selected: boolean;
  title: string;
  note?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`palChoice ${selected ? "isSelected" : ""}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      <span>{title}</span>
      {note && <small>{note}</small>}
      {selected && <Check size={17} aria-hidden="true" />}
    </button>
  );
}

function RangeControl({
  label,
  low,
  high,
  value,
  onChange,
}: {
  label: string;
  low: string;
  high: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="palRange">
      <span className="palRangeLabel">{label}</span>
      <input
        type="range"
        min="0"
        max="100"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="palRangeEnds"><small>{low}</small><small>{high}</small></span>
    </label>
  );
}

export default function PalExperience() {
  const { user, loading, configured } = useAuth();
  const [restoredOnboarding] = useState(readPalOnboardingDraft);
  const [mode, setMode] = useState<"meeting" | "onboarding" | "home">(restoredOnboarding ? "onboarding" : "meeting");
  const [step, setStep] = useState<number>(restoredOnboarding?.step ?? 0);
  const [draft, setDraft] = useState<PubPalDraft>(restoredOnboarding?.draft ?? DEFAULT_PAL_DRAFT);
  const [privacy, setPrivacy] = useState<PrivacyState>(restoredOnboarding?.privacy ?? DEFAULT_PRIVACY);
  const [pal, setPal] = useState<PubPal | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memories, setMemories] = useState<PubPalMemory[]>([]);

  useEffect(() => {
    if (mode !== "onboarding") return;
    const timer = window.setTimeout(() => writePalOnboardingDraft({
      step: Math.max(0, Math.min(4, step)) as 0 | 1 | 2 | 3 | 4,
      draft,
      privacy,
    }), 200);
    return () => window.clearTimeout(timer);
  }, [draft, mode, privacy, step]);

  useEffect(() => {
    if (!user) {
      queueMicrotask(() => setReady(true));
      return;
    }

    void authedFetch("/api/pub-pal")
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as { pal?: PubPal | null };
        const next = response.ok ? body.pal ?? null : readStoredPal(user.id);
        if (next) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          setPal(next);
          setDraft({
            adultConfirmed: true,
            name: next.name,
            appearance: next.appearance,
            personality: next.personality,
            voice: next.voice,
          });
          setPrivacy((current) => ({ ...current, visible: !next.hidden, muted: next.muted }));
          setMode("home");
          const storedPrivacy = localStorage.getItem(`${PRIVACY_KEY}:${user.id}`);
          if (storedPrivacy) {
            try {
              const parsed = JSON.parse(storedPrivacy) as { proposeMemories?: unknown };
              setPrivacy((current) => ({
                ...current,
                proposeMemories: parsed.proposeMemories === true,
                visible: !next.hidden,
                muted: next.muted,
              }));
            } catch {
              // Invalid local consent fails closed: proposals remain disabled.
            }
          }
          void authedFetch("/api/pub-pal/memories")
            .then(async (memoryResponse) => {
              const memoryBody = await memoryResponse.json().catch(() => ({})) as { memories?: PubPalMemory[] };
              if (memoryResponse.ok) setMemories(memoryBody.memories ?? []);
            })
            .catch(() => {});
        }
        setReady(true);
      })
      .catch(() => {
        const next = readStoredPal(user.id);
        if (next) {
          setPal(next);
          setMode("home");
        }
        setReady(true);
      });
  }, [user]);

  const previewName = draft.name.trim() || `Your ${speciesCopy[draft.appearance.species].title}`;
  const level = useMemo(() => Math.floor((pal?.masteryPoints ?? 0) / 50) + 1, [pal]);
  const canContinue = step !== 0 || draft.adultConfirmed;

  const updateAppearance = (patch: Partial<PubPalAppearance>) => {
    setDraft((current) => ({
      ...current,
      appearance: { ...current.appearance, ...patch },
    }));
  };

  const updatePersonality = (patch: Partial<PubPalPersonality>) => {
    setDraft((current) => ({
      ...current,
      personality: { ...current.personality, ...patch },
    }));
  };

  const createPal = async () => {
    if (!user) return;
    setSaving(true);
    setError(null);
    try {
      const response = await authedFetch("/api/pub-pal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = await response.json().catch(() => ({})) as { pal?: PubPal; error?: string };
      if (!response.ok || !body.pal) throw new Error(body.error || "Your Pal could not be created.");

      let next = body.pal;
      if (!privacy.visible || privacy.muted) {
        const controlResponse = await authedFetch("/api/pub-pal", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ hidden: !privacy.visible, muted: privacy.muted }),
        });
        const controlBody = await controlResponse.json().catch(() => ({})) as { pal?: PubPal };
        if (controlResponse.ok && controlBody.pal) next = controlBody.pal;
      }

      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      localStorage.setItem(`${PRIVACY_KEY}:${user.id}`, JSON.stringify({ proposeMemories: privacy.proposeMemories }));
      setPal(next);
      setMode("home");
      clearPalOnboardingDraft();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your Pal could not be created.");
    } finally {
      setSaving(false);
    }
  };

  const updateControl = async (patch: Partial<Pick<PubPal, "muted" | "hidden">>) => {
    if (!pal) return;
    const optimistic = { ...pal, ...patch, updatedAt: new Date().toISOString() };
    setPal(optimistic);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(optimistic));
    try {
      const response = await authedFetch("/api/pub-pal", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await response.json().catch(() => ({})) as { pal?: PubPal };
      if (response.ok && body.pal) {
        setPal(body.pal);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(body.pal));
      }
    } catch {
      setPal(pal);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pal));
    }
  };

  const removePal = async () => {
    if (!pal || !window.confirm(`Delete ${pal.name} and every confirmed memory?`)) return;
    const response = await authedFetch("/api/pub-pal", { method: "DELETE" });
    if (!response.ok) return;
    localStorage.removeItem(STORAGE_KEY);
    if (user) localStorage.removeItem(`${PRIVACY_KEY}:${user.id}`);
    setMemories([]);
    setPal(null);
    setDraft(DEFAULT_PAL_DRAFT);
    setPrivacy(DEFAULT_PRIVACY);
    setStep(0);
    setMode("meeting");
    clearPalOnboardingDraft();
  };

  if (loading || !ready) {
    return <main className="palExperience"><div className="palLoading" role="status">Waking your Pub Pal</div></main>;
  }

  if (mode === "home" && pal) {
    return (
      <main className="palExperience palHome">
        <div className="palTopbar">
          <Link href="/map"><ArrowLeft size={17} /> Map</Link>
          <span>Level {level}</span>
        </div>
        <section className="palHomeHero" aria-labelledby="pal-home-title">
          <div className="palHomePortrait">
            <PalPortrait appearance={pal.appearance} name={pal.name} state="idle" />
            <p className="palSpeech">Ready when you are. I will never make a change without showing you first.</p>
          </div>
          <div className="palHomeCopy">
            <p className="palEyebrow">Your Pub Pal</p>
            <h1 id="pal-home-title">{pal.name}</h1>
            <p>A {signalCopy[pal.appearance.signalAffinity].toLowerCase()} {pal.appearance.species} shaped around your night, with boundaries you control.</p>
            <Link className="palPrimary" href="/plan">Plan with {pal.name}<ArrowRight size={18} /></Link>
            <PubPalVoice />
          </div>
        </section>
        <section className="palControls" aria-labelledby="pal-controls-title">
          <div>
            <p className="palEyebrow">Boundaries</p>
            <h2 id="pal-controls-title">You stay in control.</h2>
            <p>Your Pal speaks only when invited. Approved facts are the only memories it can keep.</p>
          </div>
          <div className="palControlGrid">
            <button type="button" onClick={() => void updateControl({ muted: !pal.muted })} aria-pressed={pal.muted}>
              {pal.muted ? <VolumeX /> : <Volume2 />}
              <span><strong>{pal.muted ? "Muted" : "Voice available"}</strong><small>{pal.muted ? "Tap to allow voice" : "Tap to mute everywhere"}</small></span>
            </button>
            <button type="button" onClick={() => void updateControl({ hidden: !pal.hidden })} aria-pressed={pal.hidden}>
              {pal.hidden ? <EyeOff /> : <Eye />}
              <span><strong>{pal.hidden ? "Hidden" : "Visible"}</strong><small>{pal.hidden ? "Pal shortcuts are hidden" : "Pal can appear in shortcuts"}</small></span>
            </button>
            <div className="palControlReadOnly">
              <ShieldCheck />
              <span><strong>Memory by approval</strong><small>No conversation is saved as memory automatically</small></span>
            </div>
            <div className="palControlReadOnly">
              <ShieldCheck />
              <span><strong>{memories.length} approved {memories.length === 1 ? "memory" : "memories"}</strong><small>{memories.length ? "Inspect and remove them from your memory controls" : "Nothing has been saved"}</small></span>
            </div>
            <div className="palUnlockSummary" aria-label="Pub Pal progression">
              <strong>{pal.masteryPoints} mastery points</strong>
              <ul>{PAL_UNLOCKS.map((unlock) => <li key={unlock.id} className={pal.masteryPoints >= unlock.pointsRequired ? "isUnlocked" : ""}>{unlock.label}<span>{unlock.pointsRequired}</span></li>)}</ul>
            </div>
            <button className="palDanger" type="button" onClick={() => void removePal()}>
              <Trash2 />
              <span><strong>Delete {pal.name}</strong><small>Deletes the Pal and every confirmed memory</small></span>
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (mode === "meeting") {
    return (
      <main className="palExperience palMeeting">
        <div className="palTopbar">
          <Link href="/map"><ArrowLeft size={17} /> Map</Link>
          <span><LockKeyhole size={14} /> Private by default</span>
        </div>
        <section className="palMeetingStage" aria-labelledby="pal-meeting-title">
          <div className="palMeetingPortrait">
            <PalPortrait appearance={draft.appearance} name="Unclaimed Pub Pal" state="noticing" />
            <p className="palSpeech" aria-live="polite">There you are. What kind of night are we making?</p>
          </div>
          <div className="palMeetingCopy">
            <p className="palEyebrow">Meet your companion</p>
            <h1 id="pal-meeting-title">A little signal that becomes yours.</h1>
            <p>Choose its form, voice and boundaries. It can help plan the night, but you approve every important action.</p>
            <div className="palMeetingActions">
              <Button className="palPrimary" size="large" type="button" onClick={() => setMode("onboarding")}>Meet your Pub Pal<ArrowRight size={18} /></Button>
              <Link href="/map">Use PUBMAXX without a Pal</Link>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="palExperience palOnboarding">
      <div className="palTopbar">
        <button type="button" onClick={() => step === 0 ? setMode("meeting") : setStep((current) => current - 1)}><ArrowLeft size={17} /> Back</button>
        <span>{step + 1} of 5</span>
        <Link href="/map">Skip Pal</Link>
      </div>
      <div className="palProgress" aria-hidden="true"><span style={{ width: `${((step + 1) / 5) * 100}%` }} /></div>
      <div className="palOnboardingLayout">
        <div className="palOnboardingPreview">
          <PalPortrait
            appearance={draft.appearance}
            name={previewName}
            state={(["listening", "noticing", "celebrating", "speaking", "thinking"] as PalAnimationState[])[step] ?? "idle"}
          />
          <p className="palSpeech" aria-live="polite">{previewSpeech(step, draft)}</p>
        </div>
        <section className="palOnboardingPanel" aria-live="polite">
          {step === 0 && (
            <div className="palStep">
              <p className="palEyebrow">Eligibility</p>
              <h1>The grown-up bit first.</h1>
              <p>Pub Pal is designed for adults planning nights out.</p>
              <label className="palToggleRow">
                <input type="checkbox" checked={draft.adultConfirmed} onChange={(event) => setDraft((current) => ({ ...current, adultConfirmed: event.target.checked }))} />
                <span><strong>I confirm I am 18 or over</strong><small>We save the confirmation time, never your date of birth.</small></span>
              </label>
            </div>
          )}
          {step === 1 && (
            <div className="palStep">
              <p className="palEyebrow">Form and name</p>
              <h1>Who finds you?</h1>
              <p>Each Pal has the same planning intelligence. Choose the presence you want beside you.</p>
              <div className="palChoiceList palSpeciesGrid">{PAL_ONBOARDING_SPECIES.map((species) => <ChoiceButton key={species} selected={draft.appearance.species === species} title={speciesCopy[species].title} note={speciesCopy[species].note} onClick={() => updateAppearance({ species })} />)}</div>
              <label className="palField"><span>Name</span><input value={draft.name} maxLength={32} autoComplete="off" placeholder="Anything feels right" onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /><small>This is yours. Change it whenever you want.</small></label>
              <div className="palNameIdeas" aria-label="Name inspiration">
                {Object.entries(nameIdeas).map(([generation, names]) => (
                  <div key={generation}>
                    <span>{generation}</span>
                    <div>{names.map((name) => <button key={name} type="button" onClick={() => setDraft((current) => ({ ...current, name }))}>{name}</button>)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="palStep">
              <p className="palEyebrow">Appearance</p>
              <h1>Tune the signal.</h1>
              <fieldset><legend>Affinity</legend><div className="palChoiceGrid palChoiceGridThree">{SIGNAL_FAMILIES.map((signal) => <ChoiceButton key={signal} selected={draft.appearance.signalAffinity === signal} title={signalCopy[signal]} onClick={() => updateAppearance({ signalAffinity: signal })} />)}</div></fieldset>
              <fieldset><legend>Material</legend><div className="palChoiceGrid">{(["hologram", "chrome", "glass"] as const).map((material) => <ChoiceButton key={material} selected={draft.appearance.material === material} title={materialCopy[material]} onClick={() => updateAppearance({ material })} />)}</div></fieldset>
              <fieldset><legend>Accessory</legend><div className="palChoiceGrid">{(["none", "collar", "monocle", "signal-ring"] as const).map((accessory) => <ChoiceButton key={accessory} selected={draft.appearance.accessory === accessory} title={accessoryCopy[accessory]} onClick={() => updateAppearance({ accessory })} />)}</div></fieldset>
            </div>
          )}
          {step === 3 && (
            <div className="palStep">
              <p className="palEyebrow">Personality</p>
              <h1>Set the chemistry.</h1>
              <fieldset><legend>Relationship</legend><div className="palChoiceGrid">{(["guide", "sidekick", "confidant"] as const).map((relationship) => <ChoiceButton key={relationship} selected={draft.personality.relationship === relationship} title={relationshipCopy[relationship]} onClick={() => updatePersonality({ relationship })} />)}</div></fieldset>
              <RangeControl label="Temper" low="Dry" high="Playful" value={draft.personality.playfulness} onChange={(playfulness) => updatePersonality({ playfulness })} />
              <RangeControl label="Energy" low="Calm" high="Chaotic" value={draft.personality.energy} onChange={(energy) => updatePersonality({ energy })} />
              <RangeControl label="Conversation" low="Concise" high="Storytelling" value={draft.personality.storytelling} onChange={(storytelling) => updatePersonality({ storytelling })} />
              <fieldset><legend>Voice</legend>
              <div className="palChoiceList">{PAL_VOICES.map((voice) => <ChoiceButton key={voice} selected={draft.voice.id === voice} title={voice[0].toUpperCase() + voice.slice(1)} note={voiceCopy[voice]} onClick={() => setDraft((current) => ({ ...current, voice: { ...current.voice, id: voice } }))} />)}</div>
              </fieldset>
            </div>
          )}
          {step === 4 && (
            <div className="palStep">
              <p className="palEyebrow">Privacy and review</p>
              <h1>You decide what stays.</h1>
              <p>Audio and transcripts are not memories. Pub Pal can only propose short, structured facts for your approval.</p>
              <label className="palToggleRow">
                <input type="checkbox" checked={privacy.proposeMemories} onChange={(event) => setPrivacy((current) => ({ ...current, proposeMemories: event.target.checked }))} />
                <span><strong>Allow memory proposals</strong><small>{privacy.proposeMemories ? "Show each suggested fact for approval" : "Never suggest facts to remember"}</small></span>
              </label>
              <div className="palPrivacyFacts"><ShieldCheck /><p>You can inspect, correct and delete every approved memory. Safety and factuality controls cannot be disabled.</p></div>
              <div className="palReview">
                <div><span>Name</span><strong>{draft.name.trim() || "Name required"}</strong></div>
                <div><span>Form</span><strong>{speciesCopy[draft.appearance.species].title}, {materialCopy[draft.appearance.material]}</strong></div>
                <div><span>Voice</span><strong>{draft.voice.id}</strong></div>
                <div><span>Relationship</span><strong>{relationshipCopy[draft.personality.relationship]}</strong></div>
              </div>
              <label className="palToggleRow"><input type="checkbox" checked={privacy.visible} onChange={(event) => setPrivacy((current) => ({ ...current, visible: event.target.checked }))} /><span><strong>Show Pal shortcuts</strong><small>You can hide the Pal from Home, Plan and Map at any time.</small></span></label>
              <label className="palToggleRow"><input type="checkbox" checked={!privacy.muted} onChange={(event) => setPrivacy((current) => ({ ...current, muted: !event.target.checked }))} /><span><strong>Allow voice controls</strong><small>Your Pal still speaks only after you ask.</small></span></label>
              {!user && <div className="palAccountGate"><LockKeyhole /><div><strong>Sign in to make this Pal yours</strong><p>Your preview stays on this screen until you choose to sign in. Nothing is saved to an account yet.</p>{configured ? <SignInButton /> : <Link href="/map">Explore the map</Link>}</div></div>}
              {error && <p className="palError" role="alert">{error}</p>}
            </div>
          )}
          <div className="palOnboardingActions">
            <button type="button" onClick={() => step === 0 ? setMode("meeting") : setStep((current) => current - 1)}>Back</button>
            {step < 4 ? (
              <Button className="palPrimary" size="large" type="button" disabled={!canContinue || (step === 1 && !draft.name.trim())} onClick={() => setStep((current) => current + 1)}>Continue<ArrowRight size={18} /></Button>
            ) : user ? (
              <Button className="palPrimary" size="large" type="button" disabled={saving || !draft.name.trim()} onClick={() => void createPal()}>{saving ? "Creating your Pal" : "Create my Pal"}<Mic size={18} /></Button>
            ) : (
              <button type="button" onClick={() => setStep(0)}>Start over</button>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
