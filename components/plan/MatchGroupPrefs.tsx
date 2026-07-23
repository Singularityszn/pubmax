"use client";

import { useMemo, useState, useSyncExternalStore } from "react";

import {
  GROUP_PREF_ATMOSPHERE_CHIPS,
  GROUP_PREF_BUDGET_BANDS,
  overlapGroupPrefs,
  parseMatePreference,
  type GroupPrefAtmosphereChip,
  type GroupPrefBudgetBand,
  type MatePreference,
} from "@/lib/groupPrefs";

type Props = {
  planId: string;
  memberId: string;
};
type DraftPref = {
  budgetBand?: GroupPrefBudgetBand;
  atmosphereChip?: GroupPrefAtmosphereChip;
  zeroProof?: boolean;
};

const STORAGE_PREFIX = "pubmaxx:match-group-prefs:v1:";

function planStoragePrefix(planId: string): string {
  return `${STORAGE_PREFIX}${planId}:`;
}

function prefStorageKey(planId: string, memberId: string): string {
  return `${planStoragePrefix(planId)}${memberId}`;
}

function changeEvent(planId: string): string {
  return `pubmaxx:match-group-prefs:${planId}`;
}

function readPlanPrefsSnapshot(planId: string): string {
  if (typeof window === "undefined") return "[]";
  const prefix = planStoragePrefix(planId);
  const rows: Array<[string, string]> = [];
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      rows.push([key, window.localStorage.getItem(key) ?? ""]);
    }
    return JSON.stringify(rows.sort(([left], [right]) => left.localeCompare(right)));
  } catch {
    return "[]";
  }
}

function prefsFromSnapshot(snapshot: string): MatePreference[] {
  let rows: unknown;
  try {
    rows = JSON.parse(snapshot);
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!Array.isArray(row) || typeof row[1] !== "string") return [];
    try {
      const pref = parseMatePreference(JSON.parse(row[1]));
      return pref ? [pref] : [];
    } catch {
      return [];
    }
  });
}

export default function MatchGroupPrefs({ planId, memberId }: Props) {
  const [draft, setDraft] = useState<DraftPref>({});
  const [status, setStatus] = useState("");
  const snapshot = useSyncExternalStore(
    (onChange) => {
      const eventName = changeEvent(planId);
      window.addEventListener("storage", onChange);
      window.addEventListener(eventName, onChange);
      return () => {
        window.removeEventListener("storage", onChange);
        window.removeEventListener(eventName, onChange);
      };
    },
    () => readPlanPrefsSnapshot(planId),
    () => "[]",
  );
  const prefs = useMemo(() => prefsFromSnapshot(snapshot), [snapshot]);
  const myPref = useMemo(() => prefs.find((pref) => pref.mateId === memberId) ?? null, [memberId, prefs]);
  const overlap = useMemo(() => overlapGroupPrefs(prefs), [prefs]);
  const budgetBand = draft.budgetBand ?? myPref?.budgetBand ?? "";
  const atmosphereChip = draft.atmosphereChip ?? myPref?.atmosphereChips[0] ?? "";
  const zeroProof = draft.zeroProof ?? myPref?.zeroProof ?? false;

  function save(next: { budgetBand?: GroupPrefBudgetBand; atmosphereChip?: GroupPrefAtmosphereChip; zeroProof?: boolean }) {
    const nextBudget = next.budgetBand ?? budgetBand;
    const nextAtmosphere = next.atmosphereChip ?? atmosphereChip;
    const nextZeroProof = next.zeroProof ?? zeroProof;
    setDraft({ budgetBand: nextBudget || undefined, atmosphereChip: nextAtmosphere || undefined, zeroProof: nextZeroProof });
    if (!nextBudget || !nextAtmosphere) {
      setStatus("Pick a budget and a vibe to save.");
      return;
    }
    const pref: MatePreference = {
      mateId: memberId,
      budgetBand: nextBudget,
      atmosphereChips: [nextAtmosphere],
      zeroProof: nextZeroProof,
      updatedAt: new Date().toISOString(),
    };
    try {
      window.localStorage.setItem(prefStorageKey(planId, memberId), JSON.stringify(pref));
      window.dispatchEvent(new Event(changeEvent(planId)));
      setStatus("Saved on this device.");
      setDraft({});
    } catch {
      setStatus("This browser could not save your picks.");
    }
  }

  function clearPrefs() {
    try {
      window.localStorage.removeItem(prefStorageKey(planId, memberId));
      window.dispatchEvent(new Event(changeEvent(planId)));
    } catch {
      // Best effort. The controls reset even if storage is restricted.
    }
    setDraft({});
    setStatus("Device picks cleared.");
  }

  const summary = overlap.summaryLabels.join(", ");
  const meta = overlap.mateCount > 1
    ? `${overlap.scoreLabel}, ${overlap.softScore}%`
    : overlap.mateCount === 1 ? "Waiting for another saved mate on this device." : "No saved picks on this device yet.";

  return (
    <section className="matchGroupPrefs" aria-labelledby="match-group-prefs-title">
      <div className="matchGroupPrefs__heading">
        <div>
          <p className="matchGroupPrefs__eyebrow">Sort My Night P1</p>
          <h4 id="match-group-prefs-title">Match the group</h4>
        </div>
        <span>Saved on this device</span>
      </div>
      <p className="matchGroupPrefs__intro">Pick a budget, a vibe and optional zero-proof need. Another phone will not see this yet.</p>

      <div className="matchGroupPrefs__field">
        <strong>Budget</strong>
        <div className="matchGroupPrefs__chips" role="group" aria-label="Budget preference">
          {GROUP_PREF_BUDGET_BANDS.map((band) => (
            <button key={band.id} type="button" className="matchGroupPrefs__chip" aria-pressed={budgetBand === band.id} onClick={() => save({ budgetBand: band.id })}>
              {band.label}
            </button>
          ))}
        </div>
      </div>

      <div className="matchGroupPrefs__field">
        <strong>Vibe</strong>
        <div className="matchGroupPrefs__chips" role="group" aria-label="Atmosphere preference">
          {GROUP_PREF_ATMOSPHERE_CHIPS.map((chip) => (
            <button key={chip.id} type="button" className="matchGroupPrefs__chip" aria-pressed={atmosphereChip === chip.id} onClick={() => save({ atmosphereChip: chip.id })}>
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      <div className="matchGroupPrefs__actions">
        <button type="button" className="matchGroupPrefs__chip" aria-pressed={zeroProof} onClick={() => save({ zeroProof: !zeroProof })}>
          Zero-proof needed
        </button>
        <button type="button" className="planCollab__quiet" onClick={clearPrefs}>
          Clear my picks
        </button>
      </div>

      <output className="matchGroupPrefs__summary" aria-live="polite">
        Crew overlap: {summary || "waiting on mate picks"}. {meta}
      </output>
      {status ? <p className="matchGroupPrefs__status" role="status">{status}</p> : null}
    </section>
  );
}
