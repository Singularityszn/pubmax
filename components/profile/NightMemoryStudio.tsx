"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import { trackEvent } from "@/lib/analytics";
import { authedFetch } from "@/lib/authedFetch";
import type { NightMomentKind } from "@/lib/nightMemory";
import {
  readMemoryStudioDraft,
  writeMemoryStudioDraft,
  type MemoryStudioDraft,
} from "@/lib/socialDrafts";

type Memory = { id: string; title: string; createdAt: string };
type Moment = { id: string; kind: NightMomentKind; caption: string; venueId: string | null; createdAt: string };
type Story = { id: string; memoryId: string; title: string; summary: string; status: "draft" | "published"; visibility: string };

const MOMENT_LABELS: Record<MemoryStudioDraft["momentKind"], string> = {
  event: "Event",
  venue: "Place",
  quote: "Quote",
  person: "Person",
  side_quest: "Side quest",
};

export default function NightMemoryStudio({ userId }: { userId: string }) {
  const [draft, setDraft] = useState<MemoryStudioDraft>(() => readMemoryStudioDraft(userId));
  const [memories, setMemories] = useState<Memory[]>([]);
  const [moments, setMoments] = useState<Moment[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      authedFetch("/api/night-memories", { signal: controller.signal }),
      authedFetch("/api/night-stories", { signal: controller.signal }),
    ]).then(async ([memoryResponse, storyResponse]) => {
      if (controller.signal.aborted) return;
      const nextMemories = memoryResponse.ok
        ? ((await memoryResponse.json()) as { memories?: Memory[] }).memories ?? []
        : [];
      const nextStories = storyResponse.ok
        ? ((await storyResponse.json()) as { stories?: Story[] }).stories ?? []
        : [];
      setMemories(nextMemories);
      setStories(nextStories);
      setDraft((current) => ({
        ...current,
        selectedMemoryId: nextMemories.some((item) => item.id === current.selectedMemoryId)
          ? current.selectedMemoryId
          : (nextMemories[0]?.id ?? ""),
      }));
    }).catch(() => {
      if (!controller.signal.aborted) setMessage("Your Memory studio could not be loaded. Try again.");
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    writeMemoryStudioDraft(userId, draft);
  }, [draft, userId]);

  useEffect(() => {
    if (!draft.selectedMemoryId) {
      queueMicrotask(() => setMoments([]));
      return;
    }
    const controller = new AbortController();
    void authedFetch(`/api/night-memories/${encodeURIComponent(draft.selectedMemoryId)}/moments`, {
      signal: controller.signal,
    }).then(async (response) => {
      if (!controller.signal.aborted && response.ok) {
        setMoments(((await response.json()) as { moments?: Moment[] }).moments ?? []);
      }
    }).catch(() => {});
    return () => controller.abort();
  }, [draft.selectedMemoryId]);

  function update(patch: Partial<MemoryStudioDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  async function createMemory(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    const response = await authedFetch("/api/night-memories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: draft.memoryTitle }),
    });
    const body = await response.json().catch(() => ({})) as { memory?: Memory; error?: string };
    setSaving(false);
    if (!response.ok || !body.memory) return setMessage(body.error ?? "Could not create that Memory.");
    setMemories((current) => [body.memory!, ...current]);
    update({ memoryTitle: "", selectedMemoryId: body.memory.id, storyTitle: body.memory.title });
    setMessage("Private Memory created. Add the parts worth keeping.");
  }

  async function addMoment(event: FormEvent) {
    event.preventDefault();
    if (!draft.selectedMemoryId) return setMessage("Create or choose a Memory first.");
    setSaving(true);
    const response = await authedFetch(`/api/night-memories/${encodeURIComponent(draft.selectedMemoryId)}/moments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: draft.momentKind,
        caption: draft.momentCaption,
        venueId: draft.venueId || null,
        occurredAt: new Date().toISOString(),
      }),
    });
    const body = await response.json().catch(() => ({})) as { moment?: Moment; error?: string };
    setSaving(false);
    if (!response.ok || !body.moment) return setMessage(body.error ?? "Could not save that Moment.");
    setMoments((current) => [body.moment!, ...current]);
    update({ momentCaption: "", venueId: "" });
    trackEvent("night_moment_saved", { kind: body.moment.kind, visibility: "private" });
    setMessage("Moment saved privately.");
  }

  async function createStory(event: FormEvent) {
    event.preventDefault();
    if (!draft.selectedMemoryId) return setMessage("Choose a Memory before drafting its Story.");
    setSaving(true);
    const response = await authedFetch("/api/night-stories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ memoryId: draft.selectedMemoryId, title: draft.storyTitle, summary: draft.storySummary }),
    });
    const body = await response.json().catch(() => ({})) as { story?: Story; error?: string };
    setSaving(false);
    if (!response.ok || !body.story) return setMessage(body.error ?? "Could not create that Story draft.");
    setStories((current) => [body.story!, ...current]);
    update({ storyTitle: "", storySummary: "" });
    setMessage("Story draft created. It remains private until you review and publish it.");
  }

  return (
    <section className="memoryStudio" id="night-memories" aria-labelledby="memory-studio-title">
      <div className="memoryStudioHeader">
        <div>
          <p className="profileSectionKicker">Night Memory studio</p>
          <h3 id="memory-studio-title">Keep the parts you will tell people about.</h3>
        </div>
        <p>Everything starts private. A Story is a separate draft, never an automatic post.</p>
        <Link className="memoryCaptureLink" href="/moment">Capture a Moment</Link>
      </div>

      <div className="memoryStudioFlow">
        <form onSubmit={createMemory}>
          <span className="memoryStudioStep">1</span>
          <h4>Start a Memory</h4>
          <label><span>Name this night</span><input value={draft.memoryTitle} onChange={(event) => update({ memoryTitle: event.target.value })} maxLength={120} placeholder="Friday side quest" required /></label>
          <button type="submit" disabled={saving}>Create private Memory</button>
        </form>

        <form onSubmit={addMoment}>
          <span className="memoryStudioStep">2</span>
          <h4>Add a Moment</h4>
          <label><span>Memory</span><select value={draft.selectedMemoryId} onChange={(event) => update({ selectedMemoryId: event.target.value })} required><option value="">Choose a Memory</option>{memories.map((memory) => <option value={memory.id} key={memory.id}>{memory.title}</option>)}</select></label>
          <label><span>Kind</span><select value={draft.momentKind} onChange={(event) => update({ momentKind: event.target.value as MemoryStudioDraft["momentKind"] })}>{Object.entries(MOMENT_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label><span>What happened?</span><textarea value={draft.momentCaption} onChange={(event) => update({ momentCaption: event.target.value })} maxLength={500} rows={3} placeholder="We followed the music and found a tiny basement set." required /></label>
          <label><span>Venue reference <small>optional</small></span><input value={draft.venueId} onChange={(event) => update({ venueId: event.target.value })} maxLength={80} placeholder="Venue ID or map reference" /></label>
          <button type="submit" disabled={saving || !draft.selectedMemoryId}>Save private Moment</button>
        </form>

        <form onSubmit={createStory}>
          <span className="memoryStudioStep">3</span>
          <h4>Shape the Story</h4>
          <label><span>Story title</span><input value={draft.storyTitle} onChange={(event) => update({ storyTitle: event.target.value })} maxLength={120} placeholder="The night we missed the last train" required /></label>
          <label><span>Opening line <small>optional</small></span><textarea value={draft.storySummary} onChange={(event) => update({ storySummary: event.target.value })} maxLength={500} rows={3} placeholder="A plan for two turned into a table of eight." /></label>
          <button type="submit" disabled={saving || !draft.selectedMemoryId}>Create private Story draft</button>
        </form>
      </div>

      <div className="memoryStudioShelf">
        <div><strong>{memories.length}</strong><span>Memories</span></div>
        <div><strong>{moments.length}</strong><span>Moments in this Memory</span></div>
        <div><strong>{stories.length}</strong><span>Stories</span></div>
      </div>
      {stories.length ? <ul className="memoryStoryList" aria-label="Your Night Stories">{stories.slice(0, 4).map((story) => <li key={story.id}><span>{story.title}</span><small>{story.status === "draft" ? "Private draft" : story.visibility}</small></li>)}</ul> : null}
      {message ? <p role="status" className="accountHubMessage">{message}</p> : null}
    </section>
  );
}
