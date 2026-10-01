"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { authedActionFetch } from "@/lib/authedFetch";
import type { PubPalMemory, PubPalMemoryKind } from "@/lib/pubPal";
import "./palMemoryConfirmation.css";

const memoryTypes: ReadonlyArray<{ value: PubPalMemoryKind; label: string }> = [
  { value: "venue_preference", label: "Favourite pubs" },
  { value: "atmosphere_preference", label: "Atmosphere" },
  { value: "accessibility_preference", label: "Accessibility" },
  { value: "transport_preference", label: "Getting home" },
  { value: "drink_preference", label: "Favourite drinks" },
  { value: "night_outcome", label: "Past night" },
  { value: "correction", label: "Correction" },
];

type Props = {
  ownerId: string;
  palId: string;
  onConfirmed: (memory: PubPalMemory) => void;
};

export default function PalMemoryConfirmation({ ownerId, palId, onConfirmed }: Props) {
  const [kind, setKind] = useState<PubPalMemoryKind | "">("");
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const requestRef = useRef<AbortController | null>(null);
  const lifetimeRef = useRef({ ownerId, palId });

  useEffect(() => {
    lifetimeRef.current = { ownerId, palId };
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [ownerId, palId]);

  const saving = status === "saving";
  const canConfirm = Boolean(kind && value.trim() && value.length <= 500);

  const confirm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canConfirm || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    const lifetime = lifetimeRef.current;
    const chosenKind = kind;
    const current = () => !controller.signal.aborted && lifetimeRef.current === lifetime;
    setStatus("saving");
    let confirmed: PubPalMemory | null = null;
    try {
      const response = await authedActionFetch("/api/pub-pal/memories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: chosenKind, value: value.trim() }),
        signal: controller.signal,
      }, { requiresIdentity: true });
      const body = await response.json() as { memory?: PubPalMemory };
      if (!current()) return;
      const memory = body.memory;
      if (!response.ok || !memory || typeof memory.id !== "string" || !memory.id
        || memory.palId !== lifetime.palId || memory.kind !== chosenKind
        || typeof memory.value !== "string" || !memory.value.trim()
        || memory.provenance !== (chosenKind === "correction" ? "user_correction" : "user_confirmed")) {
        setStatus("error");
        return;
      }
      confirmed = memory;
      setValue("");
      setStatus("saved");
    } catch {
      if (current()) setStatus("error");
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
    if (confirmed && current()) onConfirmed(confirmed);
  };

  return (
    <form className="palMemoryConfirmation" aria-label="Save a memory" onSubmit={(event) => void confirm(event)}>
      <div className="palMemoryConfirmation__fields">
        <label>
          <span>Memory type</span>
          <select value={kind} disabled={saving} onChange={(event) => {
            const next = memoryTypes.find((type) => type.value === event.target.value)?.value ?? "";
            setKind(next);
            setStatus("idle");
          }}>
            <option value="">Choose a type</option>
            {memoryTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
          </select>
        </label>
        <label>
          <span>Fact to remember</span>
          <textarea value={value} maxLength={500} rows={3} disabled={saving} onChange={(event) => {
            setValue(event.target.value);
            setStatus("idle");
          }} />
        </label>
      </div>
      <Button type="submit" variant="secondary" disabled={saving || !canConfirm}>Confirm memory</Button>
      {status === "saving" ? <p role="status">Saving your memory</p> : null}
      {status === "saved" ? <p role="status">Saved.</p> : null}
      {status === "error" ? <p className="palError" role="alert">Could not save this memory. Try again.</p> : null}
    </form>
  );
}
