"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Camera, ImagePlus, LockKeyhole, MapPin, Sparkles, X } from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";

import SignInButton from "@/components/auth/SignInButton";
import { useAuth } from "@/components/auth/AuthProvider";
import SiteNav from "@/components/nav/SiteNav";
import { safeMomentReturnTo } from "@/components/nav/navigationModel";
import { trackEvent } from "@/lib/analytics";
import { recordMomentNudgeTrigger } from "@/lib/identityNudge";
import { authedFetch } from "@/lib/authedFetch";
import {
  createMomentDraft,
  deleteMomentDraft,
  loadMomentDraft,
  MOMENT_DRAFT_CHANNEL,
  saveMomentDraft,
  selectMomentMedia,
  type MomentDraftV1,
  type MomentMediaDraft,
} from "@/lib/momentDraft";

import "./moment.css";

const GUEST_OWNER = "guest";
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

type SaveState = "idle" | "saving" | "saved";

function newDraft(ownerKey: string): MomentDraftV1 {
  return createMomentDraft(ownerKey);
}

function makeMedia(file: File): MomentMediaDraft {
  return {
    id: crypto.randomUUID(),
    type: "image",
    name: file.name,
    mimeType: file.type,
    size: file.size,
    blob: file,
    objectUrl: URL.createObjectURL(file),
    width: null,
    height: null,
    focalX: 0.5,
    focalY: 0.5,
    alt: "",
  };
}

function withPreviewUrls(draft: MomentDraftV1): MomentDraftV1 {
  return {
    ...draft,
    media: draft.media.map((item) => ({
      ...item,
      objectUrl: item.blob ? URL.createObjectURL(item.blob) : null,
    })),
  };
}

export default function MomentCapture(): React.JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = safeMomentReturnTo(searchParams?.get("returnTo"));
  const { user, loading: authLoading } = useAuth();
  const ownerKey = user?.id ?? GUEST_OWNER;
  const [draft, setDraft] = useState<MomentDraftV1>(() => newDraft(GUEST_OWNER));
  const [hydrated, setHydrated] = useState(false);
  const [message, setMessage] = useState("Your draft stays on this device until you save it.");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savedMemoryId, setSavedMemoryId] = useState<string | null>(null);
  const previewUrls = useRef<Set<string>>(new Set());
  // Arm the identity nudge once per composer visit, the first time a signed-out
  // guest has a Moment draft worth keeping. The server save path requires auth,
  // so a signed-out capture is always a local draft — exactly when "own your
  // memories" is honest. The gate (lib/identityNudge.ts) still self-guards.
  const momentNudgeArmed = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      const owned = await loadMomentDraft(ownerKey);
      const guest = ownerKey !== GUEST_OWNER && !owned ? await loadMomentDraft(GUEST_OWNER) : null;
      const restored = owned ?? guest;
      if (cancelled) return;
      if (restored) {
        const next = withPreviewUrls({ ...restored, ownerKey });
        next.media.forEach((item) => { if (item.objectUrl) previewUrls.current.add(item.objectUrl); });
        setDraft(next);
        setMessage("Your unfinished Moment is back.");
        if (guest && ownerKey !== GUEST_OWNER) void deleteMomentDraft(GUEST_OWNER);
      } else {
        setDraft(newDraft(ownerKey));
      }
      setHydrated(true);
    }
    void restore();
    return () => { cancelled = true; };
  }, [ownerKey]);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      void saveMomentDraft(draft);
      if (!user && !momentNudgeArmed.current && (draft.caption.trim() || draft.media.length)) {
        momentNudgeArmed.current = true;
        recordMomentNudgeTrigger();
      }
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel(MOMENT_DRAFT_CHANNEL);
        channel.postMessage({ ownerKey: draft.ownerKey, revision: draft.revision });
        channel.close();
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draft, hydrated, user]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(MOMENT_DRAFT_CHANNEL);
    channel.onmessage = (event: MessageEvent<{ ownerKey?: string; revision?: number }>) => {
      if (event.data.ownerKey === draft.ownerKey && Number(event.data.revision) > draft.revision) {
        setMessage("This Moment changed in another tab. Refresh to load the latest draft.");
      }
    };
    return () => channel.close();
  }, [draft.ownerKey, draft.revision]);

  useEffect(() => () => {
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrls.current.clear();
  }, []);

  const canSave = useMemo(
    () => Boolean(draft.caption.trim() || draft.media.length) && !authLoading && saveState !== "saving",
    [authLoading, draft.caption, draft.media.length, saveState],
  );

  function update(patch: Partial<MomentDraftV1>) {
    setDraft((current) => ({
      ...current,
      ...patch,
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
    }));
    setSavedMemoryId(null);
    if (saveState === "saved") setSaveState("idle");
  }

  function chooseMedia(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    const invalid = files.find((file) => !PHOTO_TYPES.has(file.type) || file.size > MAX_PHOTO_BYTES);
    if (invalid) {
      setMessage("Choose JPEG, PNG, or WebP photos up to 10 MB each.");
      return;
    }
    const incoming = files.map(makeMedia);
    const selection = selectMomentMedia(draft.media, incoming);
    if (selection.error) {
      incoming.forEach((item) => { if (item.objectUrl) URL.revokeObjectURL(item.objectUrl); });
      setMessage(selection.error);
      return;
    }
    incoming.forEach((item) => { if (item.objectUrl) previewUrls.current.add(item.objectUrl); });
    update({ media: selection.media, kind: "photo" });
    setMessage(selection.media.length === 1 ? "Photo added. It is still private." : `${selection.media.length} photos added. They are still private.`);
  }

  function removeMedia(id: string) {
    const target = draft.media.find((item) => item.id === id);
    if (target?.objectUrl) {
      URL.revokeObjectURL(target.objectUrl);
      previewUrls.current.delete(target.objectUrl);
    }
    update({ media: draft.media.filter((item) => item.id !== id) });
  }

  async function saveMoment(event: FormEvent) {
    event.preventDefault();
    if (!user) {
      setMessage("Sign in to save this Moment. Your draft will stay here.");
      return;
    }
    if (!canSave) return;
    setSaveState("saving");
    setMessage("Saving privately...");

    let memoryId = draft.serverMemoryId;
    if (!memoryId) {
      const memoryResponse = await authedFetch("/api/night-memories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: draft.memoryTitle.trim() || "Tonight's Memory" }),
      }).catch(() => null);
      const memoryBody = memoryResponse
        ? await memoryResponse.json().catch(() => ({})) as { memory?: { id: string }; error?: string }
        : {};
      if (!memoryResponse?.ok || !memoryBody.memory) {
        setSaveState("idle");
        setMessage(memoryBody.error ?? "That Memory could not be created. Your draft is safe.");
        return;
      }
      memoryId = memoryBody.memory.id;
      update({ serverMemoryId: memoryId });
    }

    const items: Array<MomentMediaDraft | null> = draft.media.length ? draft.media : [null];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const body = item ? new FormData() : JSON.stringify({
        kind: draft.kind === "photo" ? "side_quest" : draft.kind,
        caption: draft.caption,
        venueId: draft.venueId || null,
        occurredAt: draft.occurredAt,
      });
      if (item && body instanceof FormData) {
        body.set("photo", item.blob, item.name);
        body.set("caption", index === 0 ? draft.caption : "");
        body.set("venueId", draft.venueId);
        body.set("occurredAt", draft.occurredAt);
      }
      const response = await authedFetch(
        `/api/night-memories/${encodeURIComponent(memoryId)}/moments`,
        {
          method: "POST",
          ...(body instanceof FormData ? {} : { headers: { "content-type": "application/json" } }),
          body,
        },
      ).catch(() => null);
      const responseBody = response
        ? await response.json().catch(() => ({})) as { error?: string }
        : {};
      if (!response?.ok) {
        const remaining = draft.media.slice(index);
        update({
          media: remaining,
          caption: index > 0 ? "" : draft.caption,
          serverMemoryId: response?.status === 400 ? null : memoryId,
        });
        setSaveState("idle");
        setMessage(responseBody.error ?? "Some photos could not be saved. The remaining draft is safe.");
        return;
      }
    }

    await deleteMomentDraft(ownerKey);
    draft.media.forEach((item) => {
      if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
    });
    previewUrls.current.clear();
    setSavedMemoryId(memoryId);
    setDraft(newDraft(ownerKey));
    setSaveState("saved");
    setMessage("Moment saved privately. You decide if it becomes a Story.");
    trackEvent("night_moment_saved", { kind: draft.media.length ? "photo" : draft.kind, visibility: "private" });
    router.replace(returnTo);
  }

  return (
    <div className="momentPage">
      <SiteNav />
      <main className="momentMain">
        <header className="momentIntro">
          <div className="momentIntroRail">
            <span className="momentPrivacy"><LockKeyhole size={14} aria-hidden="true" /> Private first</span>
            <Link href={returnTo} className="momentCancel">Cancel</Link>
          </div>
          <h1>Keep this one.</h1>
          <p>Take the photo now. Decide what it means, and who sees it, when the night slows down.</p>
        </header>

        <section className="momentIntent" aria-label="Choose what to capture">
          <div className="momentIntentCurrent">
            <Camera size={21} aria-hidden="true" />
            <div><strong>Private Moment</strong><span>Photos, people, places and side quests</span></div>
          </div>
          <Link href="/map?log=1" className="momentIntentLink">
            <MapPin size={21} aria-hidden="true" />
            <div><strong>Log a Pint Drop</strong><span>Verified pub, drink and price</span></div>
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </section>

        <form className="momentComposer" onSubmit={saveMoment} aria-label="Private Moment composer">
          <div className={`momentMediaGrid momentMediaGrid${draft.media.length || 1}`}>
            {draft.media.map((item) => (
              <figure className="momentMedia" key={item.id}>
                {item.objectUrl ? (
                  <Image
                    src={item.objectUrl}
                    alt={item.alt || "Moment preview"}
                    fill
                    sizes="(max-width: 640px) 50vw, 280px"
                    unoptimized
                  />
                ) : null}
                <button type="button" onClick={() => removeMedia(item.id)} aria-label={`Remove ${item.name}`}>
                  <X size={17} aria-hidden="true" />
                </button>
              </figure>
            ))}
            {draft.media.length < 4 ? (
              <label className="momentMediaPicker">
                <ImagePlus size={28} aria-hidden="true" />
                <strong>{draft.media.length ? "Add another" : "Take a photo"}</strong>
                <span>Camera or library</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  multiple
                  onChange={chooseMedia}
                />
              </label>
            ) : null}
          </div>

          <div className="momentFields">
            <label>
              <span>What happened?</span>
              <textarea
                value={draft.caption}
                onChange={(event) => update({ caption: event.target.value })}
                maxLength={500}
                rows={4}
                placeholder="One line you will still remember next year."
              />
            </label>
            <div className="momentFieldPair">
              <label>
                <span>Name this night</span>
                <input value={draft.memoryTitle} onChange={(event) => update({ memoryTitle: event.target.value })} maxLength={120} placeholder="Friday side quest" />
              </label>
              <label>
                <span>Venue reference <small>optional</small></span>
                <input value={draft.venueId} onChange={(event) => update({ venueId: event.target.value })} maxLength={80} placeholder="Choose from the map later" />
              </label>
            </div>
          </div>

          <div className="momentStatus" aria-live="polite">
            <Sparkles size={17} aria-hidden="true" />
            <span>{message}</span>
          </div>

          {user ? (
            <button className="momentSave" type="submit" disabled={!canSave}>
              {saveState === "saving" ? "Saving privately..." : "Save private Moment"}
            </button>
          ) : (
            <div className="momentSignIn">
              <p>Sign in when you are ready to keep this Moment across devices.</p>
              <SignInButton />
            </div>
          )}
        </form>

        {savedMemoryId ? (
          <section className="momentSaved" aria-labelledby="moment-saved-title">
            <h2 id="moment-saved-title">Saved. Still yours.</h2>
            <p>Open You to add more moments, choose the order and shape a Story.</p>
            <div>
              <Link href="/u/you#night-memories">Open your Memories</Link>
              <Link href="/feed">See Stories</Link>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
