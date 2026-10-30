"use client";

import { useClientReady } from "@/lib/useClientReady";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  Eye,
  EyeOff,
  LockKeyhole,
  MapPinned,
  Mic,
  ShieldCheck,
  Sparkles,
  Trash2,
  UsersRound,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerSession } from "@/components/auth/useViewerSession";
import SignInButton from "@/components/auth/SignInButton";
import { authedActionFetch } from "@/lib/authedFetch";
import { accountBoundFetch, captureAccountAuth } from "@/lib/accountBoundFetch";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import {
  DEFAULT_PAL_DRAFT,
  anonymousPalDraftOwner,
  clearPalOnboardingDraft,
  migrateLegacyPalOnboardingDraft,
  PAL_ONBOARDING_SPECIES,
  PAL_VOICES,
  SIGNAL_FAMILIES,
  palTasteAllowed,
  readPalOnboardingDraft,
  subscribePalOnboardingDraft,
  writePalOnboardingDraft,
  type PalAnimationState,
  type PalOnboardingPrivacy,
  type PubPal,
  type PubPalAppearance,
  type PubPalDraft,
  type PubPalMemory,
} from "@/lib/pubPal";
import PalPortrait from "./PalPortrait";
import PalNightQuestion from "./PalNightQuestion";
import PalQuestStamps from "./PalQuestStamps";
import PalYear from "./PalYear";
import PalPrint from "./PalPrint";
import { usePalHead3D } from "./usePalHead3D";
import { palGenomeFor } from "@/lib/palGenome";
import { createPalVoiceSignal } from "@/lib/palVoiceSignal";
import PubPalVoice from "@/components/pubpal/PubPalVoice";
import { Button } from "@/components/ui/button";
import Screen from "@/components/ui/screen";
import { setActivePlanPalContext } from "@/lib/activePlan";
import { readFirstRunCompanion } from "@/lib/firstRunTour";
import { announceLocalPalChange, LOCAL_PAL_KEY } from "@/lib/localPal";
import { safeLocalStorage } from "@/lib/safeStorage";
import { useStepHistory } from "@/lib/useStepHistory";

// How long the wake-up stretch plays after the person unmutes their Pal.
const PAL_WAKE_MS = 1_400;
const PRIVACY_KEY = "pubmax_pub_pal_privacy_v1";

const speciesCopy = {
  robin: { title: "Circuit Robin", note: "Bright · grounded" },
  greyhound: { title: "Greyhound", note: "Loyal · perceptive" },
  cat: { title: "Black Cat", note: "Calm · mischievous" },
  fox: { title: "Fox", note: "Curious · quick" },
  pigeon: { title: "Pigeon", note: "Streetwise · social" },
  badger: { title: "Badger", note: "Steady · protective" },
  corgi: { title: "Corgi", note: "Bright · encouraging" },
  hound: { title: "Signal Hound", note: "Legacy companion" },
  raven: { title: "Raven", note: "Legacy companion" },
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

type PrivacyState = PalOnboardingPrivacy;

const DEFAULT_PRIVACY: PrivacyState = {
  proposeMemories: true,
  visible: true,
  muted: false,
};

const palStateSpeech: Record<PalAnimationState, string> = {
  idle: "Ready when you are. I'll never change anything without showing you first.",
  noticing: "I hear you. Give me a second.",
  listening: "I'm listening. Nothing from this chat becomes a memory.",
  thinking: "Checking what's on record.",
  speaking: "Here's what I found. You choose what happens next.",
  celebrating: "Saved. Nice one.",
  sleeping: "I'm on mute. Tap Muted below when you want me back.",
  waking: "Awake. I'll speak when you ask.",
  error: "That failed. Text chat still works, and nothing was saved.",
};

function previewSpeech(step: number, draft: PubPalDraft): string {
  switch (step) {
    case 0: return "I'm for adults planning a night out.";
    case 1: return draft.name.trim() ? `${draft.name.trim()}. I like it.` : `A ${draft.appearance.species}. Give me a name.`;
    case 2: return `${materialCopy[draft.appearance.material]} tuned to ${signalCopy[draft.appearance.signalAffinity].toLowerCase()}.`;
    case 3: return "I'll speak only after you start voice chat.";
    default: return "Nothing becomes a memory unless you approve it.";
  }
}

// The stored Pal is a cached copy. A full or blocked localStorage costs that
// copy and nothing else: a write that throws must never drop the server's Pal,
// roll back a saved setting or leave a control lock held.
function writeStored(key: string, value: unknown): void {
  try {
    safeLocalStorage()?.setItem(key, JSON.stringify(value));
  } catch {
    // The cache is a convenience; the server holds the truth.
  }
  if (key === LOCAL_PAL_KEY) announceLocalPalChange();
}

function removeStored(key: string): void {
  try {
    safeLocalStorage()?.removeItem(key);
  } catch {
    // As above.
  }
  if (key === LOCAL_PAL_KEY) announceLocalPalChange();
}

function readStored(key: string): string | null {
  try {
    return safeLocalStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function readStoredPal(ownerId: string): PubPal | null {
  try {
    const value = JSON.parse(readStored(LOCAL_PAL_KEY) ?? "null") as (PubPal & { proposalPreferences?: PubPal["proposalPreferences"] }) | null;
    return value?.ownerId === ownerId
      ? { ...value, proposalPreferences: value.proposalPreferences ?? { memories: true, routes: true } }
      : null;
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
      {selected && <Check size={16} aria-hidden="true" />}
    </button>
  );
}

/** The taste-read opt-out. On means the Pal may read the owner's own logs. */
function PalTasteToggle({
  on,
  disabled,
  onToggle,
}: {
  on: boolean;
  disabled: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <button type="button" disabled={disabled} onClick={() => onToggle(!on)} aria-pressed={on}>
      <Sparkles />
      <span>
        <strong>Taste read {on ? "on" : "off"}</strong>
        <small>{on ? "Your favourite drink and logged pubs shape picks" : "Pal won't read your favourite drink, diary, drops or saves"}</small>
      </span>
    </button>
  );
}

/**
 * The signed-out welcome, the /pal launch screen (docs/design/LAUNCH_SCREENS.md):
 * kicker, heading, one primary action, and the map as the quiet way back.
 *
 * Extracted from PalExperience so the launch-screen audit can render it on its
 * own. The meeting copy names nobody, so the experience paints this screen on
 * the server rather than holding it behind the ready flag. Home and onboarding
 * still wait for that flag, because they name the Pal or the viewer. The
 * portrait rides beside the head on a desktop and under it on a phone, the
 * way the landing sets its pub card.
 */
export function PalMeetingScreen({
  appearance,
  onMeet,
  pending = false,
}: {
  appearance: PubPalAppearance;
  onMeet: () => void;
  pending?: boolean;
}) {
  const clientReady = useClientReady();
  return (
    <main id="main" className="palExperience palMeeting">
      <Screen
        as="section"
        className="palMeetingStage"
        kicker="Your Pub Pal"
        title="Plan your night with Pub Pal"
        titleId="pal-meeting-title"
        lede="Find a pub or plan a route. You choose its look, voice and what it can remember."
        primary={
          <>
          <button type="button" onClick={onMeet} disabled={!clientReady || pending} aria-busy={pending || undefined}>
            Meet your Pub Pal
          </button>
          {pending ? <p role="status">Opening your Pub Pal…</p> : null}
          </>
        }
        secondary={<Link href="/map">Back to the map</Link>}
      >
        <div className="palMeetingPortrait">
          {/* The meeting screen's LCP element on a desktop: measured at 403 CSS
              px square against a 288 px heading block. */}
          <PalPortrait appearance={appearance} name="Unclaimed Pub Pal" state="noticing" priority />
          <p className="palSpeech" aria-live="polite">There you are. What kind of night are we making?</p>
        </div>
      </Screen>
    </main>
  );
}

const PAL_SETUP_STEPS = [0, 1, 2, 3, 4] as const;

function PalHomeScreen({
  pal,
  palAnimationState,
  setPalAnimationState,
  controlSaving,
  saving,
  updateControl,
  updateProposalPreference,
  removePal,
  exportMemories,
  memories,
  onMemoryChange,
  editingMemoryId,
  editingMemoryValue,
  setEditingMemoryValue,
  saveMemoryCorrection,
  setEditingMemoryId,
  beginMemoryCorrection,
  removeMemory,
  error,
}: {
  pal: PubPal;
  palAnimationState: PalAnimationState;
  setPalAnimationState: Dispatch<SetStateAction<PalAnimationState>>;
  controlSaving: boolean;
  saving: boolean;
  updateControl: (patch: Partial<Pick<PubPal, "muted" | "hidden" | "crewVisible">>) => Promise<void>;
  updateProposalPreference: (kind: "memories" | "routes" | "taste", enabled: boolean) => Promise<void>;
  removePal: () => Promise<void>;
  exportMemories: () => Promise<void>;
  memories: PubPalMemory[];
  onMemoryChange: () => void;
  editingMemoryId: string;
  editingMemoryValue: string;
  setEditingMemoryValue: Dispatch<SetStateAction<string>>;
  saveMemoryCorrection: (memoryId: string) => Promise<void>;
  setEditingMemoryId: Dispatch<SetStateAction<string>>;
  beginMemoryCorrection: (memory: PubPalMemory) => void;
  removeMemory: (memory: PubPalMemory) => Promise<void>;
  error: string | null;
}) {
  const visiblePalState: PalAnimationState = pal.muted ? "sleeping" : palAnimationState;
  const proposalPreferences = pal.proposalPreferences ?? { memories: true, routes: true };
  // The voice panel publishes its live levels here and the portrait reads
  // them, so the head turns, leans and nods with the conversation.
  const [voiceSignal] = useState(createPalVoiceSignal);
  const headRef = useRef<HTMLDivElement>(null);
  // Seeded by the Pal's own id: the same genome on every device and visit.
  const genome = useMemo(() => palGenomeFor(pal.id, pal.personality), [pal.id, pal.personality]);
  usePalHead3D(headRef, { signal: voiceSignal, state: visiblePalState, temperament: genome.temperament });
  return (
    <main id="main" className="palExperience palHome">
      <section className="palHomeHero" aria-labelledby="pal-home-title">
        <div className="palHomePortrait" ref={headRef}>
          <PalPortrait appearance={pal.appearance} name={pal.name} state={visiblePalState} genome={genome} />
          <p className="palSpeech">{palStateSpeech[visiblePalState]}</p>
        </div>
        <div className="palHomeCopy">
          <p className="palEyebrow">Your Pub Pal</p>
          <h1 id="pal-home-title" tabIndex={-1}>{pal.name}</h1>
          <p>Your {signalCopy[pal.appearance.signalAffinity].toLowerCase()} {pal.appearance.species}, set up for your nights out. You decide what it can do.</p>
          <div className="palPrintRow">
            <PalPrint print={genome.print} />
            <span>{pal.name}&apos;s print. No other Pal has this one.</span>
          </div>
          <Link className="palPrimary" href="/plan">Plan with {pal.name}<ArrowRight size={16} /></Link>
          <PubPalVoice muted={pal.muted} onStateChange={setPalAnimationState} palName={pal.name} signal={voiceSignal} appearance={pal.appearance} genome={genome} onMemoryChange={onMemoryChange} />
        </div>
      </section>
      <PalNightQuestion muted={pal.muted} palName={pal.name} />
      <PalYear palName={pal.name} print={genome.print} />
      <PalQuestStamps palName={pal.name} print={genome.print} />
      <section className="palControls" aria-labelledby="pal-controls-title">
        <div>
          <p className="palEyebrow">Boundaries</p>
          <h2 id="pal-controls-title">You stay in control.</h2>
          <p>Your Pal only talks when you ask. It only remembers facts you&apos;ve approved.</p>
        </div>
        <div className="palControlGrid">
          <button type="button" disabled={controlSaving || saving} onClick={() => void updateControl({ muted: !pal.muted })} aria-pressed={pal.muted}>
            {pal.muted ? <VolumeX /> : <Volume2 />}
            <span><strong>{pal.muted ? "Muted" : "Voice allowed"}</strong><small>{pal.muted ? "Tap to allow voice" : "Tap to mute everywhere"}</small></span>
          </button>
          <button type="button" disabled={controlSaving || saving} onClick={() => void updateControl({ hidden: !pal.hidden })} aria-pressed={pal.hidden}>
            {pal.hidden ? <EyeOff /> : <Eye />}
            <span><strong>{pal.hidden ? "Hidden" : "Visible"}</strong><small>{pal.hidden ? "Pal shortcuts are off" : "Pal can appear in shortcuts"}</small></span>
          </button>
          {/* Pals walk together (lib/crewPals.ts): off until the person turns it
              on, and only crew members of the same plan ever see it. */}
          <button type="button" disabled={controlSaving || saving} onClick={() => void updateControl({ crewVisible: pal.crewVisible !== true })} aria-pressed={pal.crewVisible === true}>
            <UsersRound />
            <span><strong>{pal.crewVisible ? "Shown to your crew" : "Private to you"}</strong><small>{pal.crewVisible ? "Your crew sees it walk on a plan's map" : "Tap to let your crew see it walk on a plan's map"}</small></span>
          </button>
          <button type="button" disabled={controlSaving || saving} onClick={() => void updateProposalPreference("memories", !proposalPreferences.memories)} aria-pressed={proposalPreferences.memories}>
            <ShieldCheck />
            <span><strong>Memory proposals {proposalPreferences.memories ? "on" : "off"}</strong><small>{proposalPreferences.memories ? "Every suggestion still needs your approval" : "Pal won't suggest facts to remember"}</small></span>
          </button>
          <button type="button" disabled={controlSaving || saving} onClick={() => void updateProposalPreference("routes", !proposalPreferences.routes)} aria-pressed={proposalPreferences.routes}>
            <MapPinned />
            <span><strong>Route proposals {proposalPreferences.routes ? "on" : "off"}</strong><small>{proposalPreferences.routes ? "Only suggests. You confirm every change" : "Pal won't suggest route changes"}</small></span>
          </button>
          <PalTasteToggle on={palTasteAllowed(proposalPreferences)} disabled={controlSaving || saving} onToggle={(next) => void updateProposalPreference("taste", next)} />
          <button className="palDanger" type="button" disabled={controlSaving || saving} onClick={() => void removePal()}>
            <Trash2 />
            <span><strong>Delete {pal.name}</strong><small>Deletes the Pal and every confirmed memory</small></span>
          </button>
        </div>
      </section>
      <section className="palMemoryControls" aria-labelledby="pal-memory-title">
        <div className="palMemoryControls__header">
          <div>
            <p className="palEyebrow">Memories</p>
            <h2 id="pal-memory-title">What {pal.name} remembers.</h2>
            <p>Only facts you approve shape suggestions. Correct or delete any of them. Your audio and full chat transcripts never become memories.</p>
          </div>
          <button type="button" onClick={() => void exportMemories()} disabled={saving}><Download size={16} /> Download my memories</button>
        </div>
        {memories.length ? (
          <ul className="palMemoryList">
            {memories.map((memory) => (
              <li key={memory.id}>
                <div className="palMemoryList__meta"><span>{memory.kind.replaceAll("_", " ")}</span><small>{memory.provenance.replaceAll("_", " ")}</small></div>
                {editingMemoryId === memory.id ? (
                  <div className="palMemoryList__edit">
                    <label><span>Correct this memory</span><textarea value={editingMemoryValue} onChange={(event) => setEditingMemoryValue(event.target.value)} maxLength={500} rows={3} disabled={saving} /></label>
                    <div><button type="button" disabled={saving || !editingMemoryValue.trim()} onClick={() => void saveMemoryCorrection(memory.id)}>Save correction</button><button type="button" className="palSecondary" disabled={saving} onClick={() => { setEditingMemoryId(""); setEditingMemoryValue(""); }}>Cancel</button></div>
                  </div>
                ) : (
                  <p>{memory.value}</p>
                )}
                <div className="palMemoryList__actions">
                  {editingMemoryId !== memory.id ? <button type="button" disabled={saving} onClick={() => beginMemoryCorrection(memory)}>Correct</button> : null}
                  <button type="button" className="palDanger" disabled={saving} onClick={() => void removeMemory(memory)}><Trash2 size={16} /> Delete</button>
                </div>
              </li>
            ))}
          </ul>
        ) : <div className="palMemoryEmpty"><ShieldCheck /><p>No saved memories yet. {pal.name} can still help with tonight&apos;s route.</p></div>}
        {error ? <p className="palError" role="alert">{error}</p> : null}
      </section>
    </main>
  );
}

function PalOnboardingScreen({
  step,
  firstStep,
  stepCount,
  setMode,
  setStep,
  draft,
  setDraft,
  privacy,
  setPrivacy,
  updateAppearance,
  showPalAccountGate,
  configured,
  error,
  signedIn,
  saving,
  createPal,
}: {
  step: number;
  firstStep: number;
  stepCount: number;
  setMode: Dispatch<SetStateAction<"meeting" | "onboarding" | "home">>;
  setStep: Dispatch<SetStateAction<number>>;
  draft: PubPalDraft;
  setDraft: Dispatch<SetStateAction<PubPalDraft>>;
  privacy: PrivacyState;
  setPrivacy: Dispatch<SetStateAction<PrivacyState>>;
  updateAppearance: (patch: Partial<PubPalAppearance>) => void;
  showPalAccountGate: boolean;
  configured: boolean;
  error: string | null;
  signedIn: boolean;
  saving: boolean;
  createPal: () => Promise<void>;
}) {
  const previewName = draft.name.trim() || `Your ${speciesCopy[draft.appearance.species].title}`;
  const canContinue = step !== 0 || draft.adultConfirmed;
  return (
    <main id="main" className="palExperience palOnboarding">
      <div className="palTopbar">
        <button type="button" onClick={() => step <= firstStep ? setMode("meeting") : setStep((current) => current - 1)}><ArrowLeft size={16} /> Back</button>
        <span>{step + 1 - firstStep} of {stepCount}</span>
        <Link href="/map">Skip Pal</Link>
      </div>
      <div className="palProgress" aria-hidden="true"><span style={{ width: `${((step + 1 - firstStep) / stepCount) * 100}%` }} /></div>
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
              <p className="palEyebrow">Age check</p>
              <h1>Before you start</h1>
              <p>Pub Pal is for adults planning a night out.</p>
              <label className="palToggleRow">
                <input type="checkbox" checked={draft.adultConfirmed} onChange={(event) => setDraft((current) => ({ ...current, adultConfirmed: event.target.checked }))} />
                <span><strong>I confirm I&apos;m 18 or over</strong><small>We save the confirmation time, never your date of birth.</small></span>
              </label>
            </div>
          )}
          {step === 1 && (
            <div className="palStep">
              <p className="palEyebrow">Form and name</p>
              <h1>Choose your Pub Pal</h1>
              <p>Every Pal plans the same way. Pick the one you want with you.</p>
              <div className="palChoiceList palSpeciesGrid">{PAL_ONBOARDING_SPECIES.map((species) => <ChoiceButton key={species} selected={draft.appearance.species === species} title={speciesCopy[species].title} note={speciesCopy[species].note} onClick={() => updateAppearance({ species })} />)}</div>
              <label className="palField"><span>Name</span><input value={draft.name} maxLength={32} autoComplete="off" placeholder="Any name you like" onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /><small>This is yours. Change it whenever you want.</small></label>
              <div className="palNameIdeas" aria-label="Name ideas">
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
              <h1>Choose its look</h1>
              <fieldset><legend>Colour</legend><div className="palChoiceGrid">{SIGNAL_FAMILIES.map((signal) => <ChoiceButton key={signal} selected={draft.appearance.signalAffinity === signal} title={signalCopy[signal]} onClick={() => updateAppearance({ signalAffinity: signal })} />)}</div></fieldset>
              <fieldset><legend>Material</legend><div className="palChoiceGrid">{(["hologram", "chrome", "glass"] as const).map((material) => <ChoiceButton key={material} selected={draft.appearance.material === material} title={materialCopy[material]} onClick={() => updateAppearance({ material })} />)}</div></fieldset>
              <fieldset><legend>Accessory</legend><div className="palChoiceGrid">{(["none", "collar", "monocle", "signal-ring"] as const).map((accessory) => <ChoiceButton key={accessory} selected={draft.appearance.accessory === accessory} title={accessoryCopy[accessory]} onClick={() => updateAppearance({ accessory })} />)}</div></fieldset>
            </div>
          )}
          {step === 3 && (
            <div className="palStep">
              <p className="palEyebrow">Voice</p>
              <h1>Choose a voice.</h1>
              {(draft.personality.relationship !== DEFAULT_PAL_DRAFT.personality.relationship ||
                draft.personality.playfulness !== DEFAULT_PAL_DRAFT.personality.playfulness ||
                draft.personality.energy !== DEFAULT_PAL_DRAFT.personality.energy ||
                draft.personality.storytelling !== DEFAULT_PAL_DRAFT.personality.storytelling) ? (
                <p>Character settings do not change replies yet. Your saved choices stay with your Pal.</p>
              ) : null}
              <fieldset><legend>Voice</legend>
              <div className="palChoiceList">{PAL_VOICES.map((voice) => <ChoiceButton key={voice} selected={draft.voice.id === voice} title={voice.charAt(0).toUpperCase() + voice.slice(1)} note={voiceCopy[voice]} onClick={() => setDraft((current) => ({ ...current, voice: { ...current.voice, id: voice } }))} />)}</div>
              </fieldset>
              <p>If this voice isn&apos;t available, your Pal uses its default voice.</p>
            </div>
          )}
          {step === 4 && (
            <div className="palStep">
              <p className="palEyebrow">Privacy and review</p>
              <h1>You decide what stays.</h1>
              <p>Audio and transcripts aren&apos;t memories. Pub Pal can only suggest short, structured facts, and you approve each one.</p>
              <label className="palToggleRow">
                <input type="checkbox" checked={privacy.proposeMemories} onChange={(event) => setPrivacy((current) => ({ ...current, proposeMemories: event.target.checked }))} />
                <span><strong>Allow memory proposals</strong><small>{privacy.proposeMemories ? "Show each suggested fact for approval" : "Never suggest facts to remember"}</small></span>
              </label>
              <div className="palPrivacyFacts"><ShieldCheck /><p>You can view, correct and delete every approved memory. You can&apos;t switch off the safety and accuracy controls.</p></div>
              <div className="palReview">
                <div><span>Name</span><strong>{draft.name.trim() || "Add a name"}</strong></div>
                <div><span>Form</span><strong>{speciesCopy[draft.appearance.species].title}, {materialCopy[draft.appearance.material]}</strong></div>
                <div><span>Voice</span><strong>{draft.voice.id}</strong></div>
              </div>
              <label className="palToggleRow"><input type="checkbox" checked={privacy.visible} onChange={(event) => setPrivacy((current) => ({ ...current, visible: event.target.checked }))} /><span><strong>Show Pal shortcuts</strong><small>You can hide the Pal from Home, Plan and Map at any time.</small></span></label>
              <label className="palToggleRow"><input type="checkbox" checked={!privacy.muted} onChange={(event) => setPrivacy((current) => ({ ...current, muted: !event.target.checked }))} /><span><strong>Allow voice controls</strong><small>Your Pal still speaks only after you ask.</small></span></label>
              {showPalAccountGate && <div className="palAccountGate"><LockKeyhole /><div><strong>Sign in to make this Pal yours</strong><p>Your preview stays on this screen until you sign in. Nothing&apos;s saved to an account yet.</p>{configured ? <SignInButton /> : <Link href="/map">Explore the map</Link>}</div></div>}
              {error && <p className="palError" role="alert">{error}</p>}
            </div>
          )}
          <div className="palOnboardingActions">
            <button type="button" onClick={() => step <= firstStep ? setMode("meeting") : setStep((current) => current - 1)}>Back</button>
            {step < 4 ? (
              <Button className="palPrimary" size="large" type="button" disabled={!canContinue || (step === 1 && !draft.name.trim())} onClick={() => setStep((current) => current + 1)}>Continue<ArrowRight size={16} /></Button>
            ) : signedIn ? (
              <Button className="palPrimary" size="large" type="button" disabled={saving || !draft.name.trim()} onClick={() => void createPal()}>{saving ? "Creating your Pal" : "Create my Pal"}<Mic size={16} /></Button>
            ) : (
              <button type="button" onClick={() => setStep(0)}>Start over</button>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

export default function PalExperience() {
  const { user, session, loading, configured } = useAuth();
  const palViewerSession = useViewerSession();
  // The account gate is a claim about the viewer, so it waits for the live
  // session rather than reading a null user as a settled sign-out.
  const showPalAccountGate = palViewerSession.signedOut;
  const [anonymousOwner] = useState(anonymousPalDraftOwner);
  const [draftOwner, setDraftOwner] = useState("");
  const [mode, setMode] = useState<"meeting" | "onboarding" | "home">("meeting");
  const [step, setStep] = useState<number>(0);
  const [draft, setDraft] = useState<PubPalDraft>(DEFAULT_PAL_DRAFT);
  const [privacy, setPrivacy] = useState<PrivacyState>(DEFAULT_PRIVACY);
  const [pal, setPal] = useState<PubPal | null>(null);
  const [ready, setReady] = useState(false);
  // The account already answered the age question as an adult (a stored date of
  // birth or the recorded tap), so setup does not ask it a second time.
  const [adultOnFile, setAdultOnFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memories, setMemories] = useState<PubPalMemory[]>([]);
  const [palAnimationState, setPalAnimationState] = useState<PalAnimationState>("idle");
  const [editingMemoryId, setEditingMemoryId] = useState("");
  const [editingMemoryValue, setEditingMemoryValue] = useState("");
  const [controlSaving, setControlSaving] = useState(false);
  const [activeOwnerId, setActiveOwnerId] = useState("");
  const activeOwnerRef = useRef("");
  const palMutationRef = useRef<{ ownerId: string; requestId: number } | null>(null);
  const controlSavingRef = useRef<{ ownerId: string; requestId: number } | null>(null);
  const controlRequestIdRef = useRef(0);
  const palAnimationTimerRef = useRef(0);

  // One animation at a time: a new one cancels the last one's return to idle,
  // and leaving the page cancels it too, so no timer fires after unmount.
  useEffect(() => () => window.clearTimeout(palAnimationTimerRef.current), []);
  const playPalAnimation = (state: PalAnimationState, ms: number) => {
    window.clearTimeout(palAnimationTimerRef.current);
    setPalAnimationState(state);
    palAnimationTimerRef.current = window.setTimeout(() => setPalAnimationState("idle"), ms);
  };

  useEffect(() => {
    if (loading) return;
    const owner = user?.id ?? anonymousOwner;
    if (owner === draftOwner) return;
    let restored = readPalOnboardingDraft(owner);
    if (user && !restored) {
      const anonymousDraft = readPalOnboardingDraft(anonymousOwner);
      if (anonymousDraft) {
        restored = anonymousDraft;
        writePalOnboardingDraft(owner, { step: restored.step, draft: restored.draft, privacy: restored.privacy });
        clearPalOnboardingDraft(anonymousOwner);
      }
    }
    restored ??= migrateLegacyPalOnboardingDraft(owner);
    const rememberedCompanion = readFirstRunCompanion();
    const firstRunDraft = rememberedCompanion
      ? {
          ...DEFAULT_PAL_DRAFT,
          appearance: {
            ...DEFAULT_PAL_DRAFT.appearance,
            species: rememberedCompanion,
          },
        }
      : DEFAULT_PAL_DRAFT;
    // The meeting screen paints before the owner settles, so "Meet your Pub
    // Pal" can already have opened onboarding. On that first settle keep the
    // viewer's choice; a later owner change still starts from the meeting.
    const firstSettle = draftOwner === "";
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setDraftOwner(owner);
      setMode((current) =>
        restored || (firstSettle && current === "onboarding") ? "onboarding" : "meeting",
      );
      setStep(restored?.step ?? 0);
      setDraft(restored?.draft ?? firstRunDraft);
      setPrivacy(restored?.privacy ?? DEFAULT_PRIVACY);
    });
    return () => { cancelled = true; };
  }, [anonymousOwner, draftOwner, loading, user]);

  // Browser Back walks the five setup steps instead of leaving /pal. The draft
  // above keeps the choices either way.
  // An account that already answered 18+ never sees step 0, so the history
  // walks only the steps it can see: Back never restores the hidden one.
  const visibleSteps = adultOnFile ? PAL_SETUP_STEPS.filter((candidate) => candidate >= 1) : PAL_SETUP_STEPS;
  useStepHistory(Math.max(step, adultOnFile ? 1 : 0) as (typeof PAL_SETUP_STEPS)[number], setStep, {
    steps: visibleSteps,
    first: adultOnFile ? 1 : 0,
    enabled: mode === "onboarding",
  });

  useEffect(() => {
    if (mode !== "onboarding" || !draftOwner) return;
    const save = () => writePalOnboardingDraft(draftOwner, {
      step: Math.max(0, Math.min(4, step)) as 0 | 1 | 2 | 3 | 4,
      draft,
      privacy,
    });
    const timer = window.setTimeout(save, 200);
    // A reload inside the 200 ms wait would restore a stale step, so the page
    // leaving writes the draft at once.
    window.addEventListener("pagehide", save);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", save);
    };
  }, [draft, draftOwner, mode, privacy, step]);

  useEffect(() => {
    if (!draftOwner) return;
    return subscribePalOnboardingDraft(draftOwner, () => {
      const restored = readPalOnboardingDraft(draftOwner);
      if (!restored) return;
      setStep(restored.step);
      setDraft(restored.draft);
      setPrivacy(restored.privacy);
      setMode("onboarding");
    });
  }, [draftOwner]);

  useEffect(() => {
    const ownerId = user?.id ?? "";
    const controller = new AbortController();
    activeOwnerRef.current = ownerId;
    queueMicrotask(() => {
      if (activeOwnerRef.current !== ownerId) return;
      setActiveOwnerId(ownerId);
      setAdultOnFile(false);
      setPal(null);
      setMemories([]);
      setEditingMemoryId("");
      setEditingMemoryValue("");
      setError(null);
      setActivePlanPalContext(null);
      palMutationRef.current = null;
      setSaving(false);
      controlSavingRef.current = null;
      setControlSaving(false);
      setReady(!user);
    });
    if (!user) return () => controller.abort();

    void authedActionFetch("/api/pub-pal", { signal: controller.signal }, { requiresIdentity: true })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as { pal?: PubPal | null; adultOnFile?: boolean };
        if (controller.signal.aborted || activeOwnerRef.current !== ownerId) return;
        setAdultOnFile(response.ok && body.adultOnFile === true);
        const next = response.ok ? body.pal ?? null : readStoredPal(user.id);
        if (next?.ownerId === ownerId) {
          setActivePlanPalContext({ id: next.id, name: next.name });
          writeStored(LOCAL_PAL_KEY, next);
          setPal(next);
          setDraft({
            adultConfirmed: true,
            name: next.name,
            appearance: next.appearance,
            personality: next.personality,
            voice: next.voice,
          });
          setPrivacy((current) => ({ ...current, proposeMemories: next.proposalPreferences?.memories === true, visible: !next.hidden, muted: next.muted }));
          setMode("home");
          const storedPrivacy = readStored(`${PRIVACY_KEY}:${user.id}`);
          if (storedPrivacy) {
            try {
              const parsed = JSON.parse(storedPrivacy) as { proposeMemories?: unknown };
              setPrivacy((current) => ({
                ...current,
                proposeMemories: next.proposalPreferences?.memories ?? parsed.proposeMemories !== false,
                visible: !next.hidden,
                muted: next.muted,
              }));
            } catch {
              // Invalid local consent fails closed: proposals remain disabled.
            }
          }
          void authedActionFetch("/api/pub-pal/memories", { signal: controller.signal }, { requiresIdentity: true })
            .then(async (memoryResponse) => {
              const memoryBody = await memoryResponse.json().catch(() => ({})) as { memories?: PubPalMemory[] };
              if (!controller.signal.aborted && activeOwnerRef.current === ownerId && memoryResponse.ok) setMemories(memoryBody.memories ?? []);
            })
            .catch(() => {});
        }
        if (!controller.signal.aborted && activeOwnerRef.current === ownerId) setReady(true);
      })
      .catch(() => {
        if (controller.signal.aborted || activeOwnerRef.current !== ownerId) return;
        const next = readStoredPal(user.id);
        if (next?.ownerId === ownerId) {
          setActivePlanPalContext({ id: next.id, name: next.name });
          setPal(next);
          setMode("home");
        }
        setReady(true);
      });
    return () => controller.abort();
  }, [user]);

  // Creating the Pal swaps the whole screen. The page kept the scroll position
  // the person had reached at the foot of setup, so it landed on "You stay in
  // control" in the middle of the new screen. Start at the top, on the Pal's
  // name, which is also where keyboard focus belongs once the button that was
  // pressed has gone.
  const previousMode = useRef(mode);
  useEffect(() => {
    const created = previousMode.current === "onboarding" && mode === "home";
    previousMode.current = mode;
    if (!created) return;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    document.getElementById("pal-home-title")?.focus({ preventScroll: true });
  }, [mode]);

  // "We ask once": an account that already answered as an adult starts at the
  // Pal itself. The confirmation the server stores with the Pal is carried by
  // that answer, so the first step is skipped rather than shown a second time.
  const firstStep = adultOnFile ? 1 : 0;
  const stepCount = 5 - firstStep;
  if (adultOnFile && mode === "onboarding" && !pal && (step < firstStep || !draft.adultConfirmed)) {
    setStep((current) => Math.max(current, firstStep));
    setDraft((current) => (current.adultConfirmed ? current : { ...current, adultConfirmed: true }));
  }

  const updateAppearance = (patch: Partial<PubPalAppearance>) => {
    setDraft((current) => ({
      ...current,
      appearance: { ...current.appearance, ...patch },
    }));
  };

  const createPal = async () => {
    if (!user) return;
    if (palMutationRef.current || controlSavingRef.current) return;
    const ownerId = user.id;
    const lock = { ownerId, requestId: ++controlRequestIdRef.current };
    palMutationRef.current = lock;
    setSaving(true);
    setError(null);
    try {
      const response = await authedActionFetch("/api/pub-pal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...draft,
          hidden: !privacy.visible,
          muted: privacy.muted,
          proposalPreferences: { memories: privacy.proposeMemories, routes: true },
        }),
      }, { requiresIdentity: true });
      const body = await response.json().catch(() => ({})) as { pal?: PubPal; error?: string };
      if (!response.ok || !body.pal) throw new Error(errorMessageFrom(body, "We couldn't create your Pal."));

      const next = body.pal;
      if (activeOwnerRef.current !== ownerId || next.ownerId !== ownerId) return;

      writeStored(LOCAL_PAL_KEY, next);
      writeStored(`${PRIVACY_KEY}:${ownerId}`, { proposeMemories: privacy.proposeMemories });
      setPal(next);
      setActivePlanPalContext({ id: next.id, name: next.name });
      setMode("home");
      clearPalOnboardingDraft(draftOwner);
    } catch (cause) {
      if (activeOwnerRef.current !== ownerId) return;
      setError(cause instanceof Error ? cause.message : "We couldn't create your Pal.");
    } finally {
      if (palMutationRef.current === lock) {
        palMutationRef.current = null;
        setSaving(false);
      }
    }
  };

  const updateControl = async (patch: Partial<Pick<PubPal, "muted" | "hidden" | "crewVisible">>) => {
    if (!pal || controlSavingRef.current || palMutationRef.current) return;
    const ownerId = pal.ownerId;
    const lock = { ownerId, requestId: ++controlRequestIdRef.current };
    controlSavingRef.current = lock;
    setControlSaving(true);
    const optimistic = { ...pal, ...patch, updatedAt: new Date().toISOString() };
    setPal(optimistic);
    writeStored(LOCAL_PAL_KEY, optimistic);
    try {
      const response = await authedActionFetch("/api/pub-pal", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      }, { requiresIdentity: true });
      const body = await response.json().catch(() => ({})) as { pal?: PubPal; error?: unknown };
      if (!response.ok || !body.pal) {
        throw new Error(errorMessageFrom(body, "We couldn't save that Pal setting."));
      }
      if (activeOwnerRef.current !== ownerId || body.pal.ownerId !== ownerId) return;
      setPal(body.pal);
      writeStored(LOCAL_PAL_KEY, body.pal);
      // A Pal the person just unmuted stretches awake. Any other setting
      // gets the plain "saved" celebration.
      const woke = patch.muted === false && !body.pal.muted;
      playPalAnimation(woke ? "waking" : "celebrating", woke ? PAL_WAKE_MS : 900);
    } catch (cause) {
      if (activeOwnerRef.current !== ownerId) return;
      setPalAnimationState("error");
      setPal(pal);
      writeStored(LOCAL_PAL_KEY, pal);
      setError(
        offlineOrMessage(cause instanceof Error
            ? cause.message
            : "We couldn't save that Pal setting.")
      );
    } finally {
      if (controlSavingRef.current === lock) {
        controlSavingRef.current = null;
        setControlSaving(false);
      }
    }
  };

  const updateProposalPreference = async (kind: "memories" | "routes" | "taste", enabled: boolean) => {
    if (!pal || controlSavingRef.current || palMutationRef.current) return;
    const ownerId = pal.ownerId;
    const lock = { ownerId, requestId: ++controlRequestIdRef.current };
    controlSavingRef.current = lock;
    setControlSaving(true);
    const previous = { ...pal, proposalPreferences: pal.proposalPreferences ?? { memories: true, routes: true } };
    const proposalPreferences = { ...previous.proposalPreferences, [kind]: enabled };
    const optimistic = { ...pal, proposalPreferences, updatedAt: new Date().toISOString() };
    setPal(optimistic);
    if (kind === "memories") setPrivacy((current) => ({ ...current, proposeMemories: enabled }));
    writeStored(LOCAL_PAL_KEY, optimistic);
    try {
      const response = await authedActionFetch("/api/pub-pal", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proposalPreferences }),
      }, { requiresIdentity: true });
      const body = await response.json().catch(() => ({})) as { pal?: PubPal; error?: string };
      if (!response.ok || !body.pal) throw new Error(errorMessageFrom(body, "We couldn't save your suggestion settings."));
      if (activeOwnerRef.current !== ownerId || body.pal.ownerId !== ownerId) return;
      setPal(body.pal);
      writeStored(LOCAL_PAL_KEY, body.pal);
      playPalAnimation("celebrating", 900);
    } catch (cause) {
      if (activeOwnerRef.current !== ownerId) return;
      setPal(previous);
      setPrivacy((current) => ({ ...current, proposeMemories: previous.proposalPreferences.memories }));
      writeStored(LOCAL_PAL_KEY, previous);
      setError(cause instanceof Error ? cause.message : "We couldn't save your suggestion settings.");
      setPalAnimationState("error");
    } finally {
      if (controlSavingRef.current === lock) {
        controlSavingRef.current = null;
        setControlSaving(false);
      }
    }
  };

  const beginMemoryCorrection = (memory: PubPalMemory) => {
    setEditingMemoryId(memory.id);
    setEditingMemoryValue(memory.value);
  };

  const saveMemoryCorrection = async (memoryId: string) => {
    if (!editingMemoryValue.trim() || !pal || palMutationRef.current || controlSavingRef.current) return;
    const ownerId = pal.ownerId;
    const lock = { ownerId, requestId: ++controlRequestIdRef.current };
    palMutationRef.current = lock;
    setSaving(true);
    setError(null);
    try {
      const response = await authedActionFetch(`/api/pub-pal/memories/${encodeURIComponent(memoryId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: editingMemoryValue }),
      }, { requiresIdentity: true });
      const body = await response.json().catch(() => ({})) as { memory?: PubPalMemory; error?: string };
      if (!response.ok || !body.memory) throw new Error(errorMessageFrom(body, "We couldn't save that correction."));
      if (activeOwnerRef.current !== ownerId) return;
      setMemories((current) => current.map((memory) => memory.id === memoryId ? body.memory! : memory));
      setEditingMemoryId("");
      setEditingMemoryValue("");
      playPalAnimation("celebrating", 900);
    } catch (cause) {
      if (activeOwnerRef.current !== ownerId) return;
      setError(cause instanceof Error ? cause.message : "We couldn't save that correction.");
      setPalAnimationState("error");
    } finally {
      if (palMutationRef.current === lock) {
        palMutationRef.current = null;
        setSaving(false);
      }
    }
  };

  const removeMemory = async (memory: PubPalMemory) => {
    if (!pal || palMutationRef.current || controlSavingRef.current || !window.confirm(`Delete this confirmed memory?\n\n${memory.value}`)) return;
    const ownerId = pal.ownerId;
    const lock = { ownerId, requestId: ++controlRequestIdRef.current };
    palMutationRef.current = lock;
    setSaving(true);
    setError(null);
    try {
      const response = await authedActionFetch(`/api/pub-pal/memories/${encodeURIComponent(memory.id)}`, { method: "DELETE" }, { requiresIdentity: true });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(errorMessageFrom(body, "We couldn't delete that memory."));
      if (activeOwnerRef.current !== ownerId) return;
      setMemories((current) => current.filter((item) => item.id !== memory.id));
      if (editingMemoryId === memory.id) {
        setEditingMemoryId("");
        setEditingMemoryValue("");
      }
    } catch (cause) {
      if (activeOwnerRef.current !== ownerId) return;
      setError(cause instanceof Error ? cause.message : "We couldn't delete that memory.");
    } finally {
      if (palMutationRef.current === lock) {
        palMutationRef.current = null;
        setSaving(false);
      }
    }
  };

  const exportMemories = async () => {
    if (!pal || palMutationRef.current || controlSavingRef.current) return;
    const ownerId = pal.ownerId;
    const palName = pal.name;
    const lock = { ownerId, requestId: ++controlRequestIdRef.current };
    palMutationRef.current = lock;
    setSaving(true);
    setError(null);
    try {
      const response = await authedActionFetch("/api/pub-pal/memories/export", {}, { requiresIdentity: true });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(errorMessageFrom(body, "We couldn't download your Pal's memories."));
      }
      const blob = await response.blob();
      if (activeOwnerRef.current !== ownerId) return;
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `pubmaxx-pal-memory-${palName.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "export"}.json`;
      anchor.click();
      URL.revokeObjectURL(href);
    } catch (cause) {
      if (activeOwnerRef.current !== ownerId) return;
      setError(cause instanceof Error ? cause.message : "We couldn't download your Pal's memories.");
    } finally {
      if (palMutationRef.current === lock) {
        palMutationRef.current = null;
        setSaving(false);
      }
    }
  };

  const removePal = async () => {
    if (!pal || palMutationRef.current || controlSavingRef.current || !window.confirm(`Delete ${pal.name} and every confirmed memory?`)) return;
    const ownerId = pal.ownerId;
    const lock = { ownerId, requestId: ++controlRequestIdRef.current };
    palMutationRef.current = lock;
    setSaving(true);
    setError(null);
    try {
      const response = await authedActionFetch("/api/pub-pal", { method: "DELETE" }, { requiresIdentity: true });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(errorMessageFrom(body, "We couldn't delete your Pal."));
      if (activeOwnerRef.current !== ownerId) return;
      removeStored(LOCAL_PAL_KEY);
      removeStored(`${PRIVACY_KEY}:${ownerId}`);
      setActivePlanPalContext(null);
      setMemories([]);
      setPal(null);
      setDraft(DEFAULT_PAL_DRAFT);
      setPrivacy(DEFAULT_PRIVACY);
      setStep(0);
      setMode("meeting");
      clearPalOnboardingDraft(draftOwner);
    } catch (cause) {
      if (activeOwnerRef.current !== ownerId) return;
      setError(cause instanceof Error ? cause.message : "We couldn't delete your Pal.");
    } finally {
      if (palMutationRef.current === lock) {
        palMutationRef.current = null;
        setSaving(false);
      }
    }
  };

  const ownerTransitioning = !loading && (
    activeOwnerId !== (user?.id ?? "") ||
    draftOwner !== (user?.id ?? anonymousOwner)
  );
  if (loading || !ready || ownerTransitioning) {
    return (
      <PalMeetingScreen
        pending={mode === "onboarding"}
        appearance={draft.appearance}
        onMeet={() => setMode("onboarding")}
      />
    );
  }

  if (mode === "home" && pal && user && pal.ownerId === user.id) {
    return (
      <PalHomeScreen
        pal={pal}
        palAnimationState={palAnimationState}
        setPalAnimationState={setPalAnimationState}
        controlSaving={controlSaving}
        saving={saving}
        updateControl={updateControl}
        updateProposalPreference={updateProposalPreference}
        removePal={removePal}
        exportMemories={exportMemories}
        memories={memories}
        onMemoryChange={() => {
          const ownerId = user.id;
          const auth = captureAccountAuth(ownerId, session);
          void accountBoundFetch(auth, "/api/pub-pal/memories").then(async (response) => {
            const body = await response.json() as { memories?: PubPalMemory[] };
            if (response.ok && activeOwnerRef.current === ownerId) setMemories(body.memories ?? []);
          }).catch(() => {});
        }}
        editingMemoryId={editingMemoryId}
        editingMemoryValue={editingMemoryValue}
        setEditingMemoryValue={setEditingMemoryValue}
        saveMemoryCorrection={saveMemoryCorrection}
        setEditingMemoryId={setEditingMemoryId}
        beginMemoryCorrection={beginMemoryCorrection}
        removeMemory={removeMemory}
        error={error}
      />
    );
  }

  if (mode === "meeting") {
    return (
      <PalMeetingScreen
        appearance={draft.appearance}
        onMeet={() => setMode("onboarding")}
      />
    );
  }

  return (
    <PalOnboardingScreen
      step={step}
      firstStep={firstStep}
      stepCount={stepCount}
      setMode={setMode}
      setStep={setStep}
      draft={draft}
      setDraft={setDraft}
      privacy={privacy}
      setPrivacy={setPrivacy}
      updateAppearance={updateAppearance}
      showPalAccountGate={showPalAccountGate}
      configured={configured}
      error={error}
      signedIn={Boolean(user)}
      saving={saving}
      createPal={createPal}
    />
  );
}
