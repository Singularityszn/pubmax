"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { readProviderAccountSignal } from "@/lib/authProviderRevision";
import { loadOutingStepsBridge, type OutingStepsBridge, type OutingStepsStatus } from "@/lib/nativeOutingSteps";
import { nativePlatform } from "@/lib/nativePlatform";
import { OUTING_STEPS_MAX_MS, transitionOutingSteps, type OutingStepsEvent, type OutingStepsState } from "@/lib/outingSteps";
import { beginOutingSteps, readOutingSteps, readOutingStepsEvent, writeOutingSteps } from "@/lib/outingStepsSession";

import "./outingSteps.css";

const SAMPLE_MS = 30_000;

function clock(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }).format(new Date(ms));
}

function stepCount(steps: number, gap: boolean): string {
  return `${gap ? "At least " : ""}${steps.toLocaleString("en-GB")} ${steps === 1 ? "step" : "steps"}`;
}

/** Opt-in steps measured by this phone for one night. Native shell only. */
export default function OutingSteps({ planId }: { planId: string }) {
  const { user, loading, accountRevision } = useAuth();
  if (loading) return null;
  const owner = user?.id ?? null;
  return <OwnedOutingSteps key={`${owner ?? "guest"}:${accountRevision ?? 0}`} planId={planId} owner={owner} />;
}

function OwnedOutingSteps({ planId, owner }: { planId: string; owner: string | null }) {
  const [bridge, setBridge] = useState<OutingStepsBridge | null>(null);
  const [status, setStatus] = useState<OutingStepsStatus | null>(null);
  const [state, setState] = useState<OutingStepsState>(() => readOutingSteps(owner));
  const [busy, setBusy] = useState<"asking" | "stopping" | null>(null);
  const [problem, setProblem] = useState("");
  const [ownerSignal] = useState(readProviderAccountSignal);
  const stateRef = useRef(state);
  const counting = state.phase === "counting" ? state.startedAt : null;

  useEffect(() => {
    let live = true;
    void loadOutingStepsBridge().then(async (loaded) => {
      const first = loaded ? await loaded.status().catch(() => null) : null;
      if (!live || !loaded || !first) return;
      setBridge(loaded);
      setStatus(first);
    });
    return () => { live = false; };
  }, []);

  const apply = useCallback((event: OutingStepsEvent) => {
    const previous = stateRef.current;
    const next = transitionOutingSteps(previous, event);
    if (next === previous || ownerSignal.aborted) return;
    stateRef.current = next;
    writeOutingSteps(next);
    setState(next);
    // Android keeps a sensor listener between readings. Release it whenever nothing is counting.
    if (previous.phase === "counting" && next.phase !== "counting") void bridge?.stop({ session: previous.session });
  }, [bridge, ownerSignal]);

  const read = useCallback(async () => {
    if (!bridge) return;
    const outcome = await readOutingStepsEvent(bridge, stateRef.current, { signal: ownerSignal, now: Date.now });
    if (outcome.kind === "event") apply(outcome.event);
    if (outcome.kind === "refused") setStatus(outcome.status);
    if (outcome.kind === "stale") return;
    setProblem(outcome.kind === "failed" ? "We couldn't read your steps just now. Your count so far is kept." : "");
  }, [apply, bridge, ownerSignal]);

  useEffect(() => {
    if (!bridge || counting === null) return;
    queueMicrotask(() => void read());
    const poll = window.setInterval(() => { if (document.visibilityState !== "hidden") void read(); }, SAMPLE_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void read(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [bridge, counting, read]);

  async function start() {
    if (!bridge) return;
    setBusy("asking");
    setProblem("");
    const outcome = await beginOutingSteps(bridge, { planId, owner, signal: ownerSignal, now: Date.now });
    if (outcome.kind === "started") apply(outcome.event);
    if (outcome.kind === "refused") setStatus(outcome.status);
    if (outcome.kind === "failed") setProblem("We couldn't start counting. Try again.");
    setBusy(null);
  }

  async function stop() {
    const current = stateRef.current;
    if (current.phase !== "counting") return;
    setBusy("stopping");
    await read();
    apply({ type: "stop", session: current.session, at: Date.now() });
    setBusy(null);
  }

  if (!bridge || !status) return null;
  const mine = state.phase !== "off" && state.planId === planId;
  if (!status.available && !mine && state.phase !== "counting") return null;

  const denied = status.permission === "denied";
  const settings = nativePlatform() === "android"
    ? "Allow Physical activity for PUBMAXXING in your phone settings, then try again."
    : "Turn on Motion & Fitness for PUBMAXXING in Settings, then try again.";
  const stopButton = (
    <Button variant="secondary" disabled={busy !== null} onClick={() => void stop()}>
      {busy === "stopping" ? "Stopping" : "Stop counting"}
    </Button>
  );

  return (
    <section className="outingSteps" aria-label="Steps tonight" aria-busy={busy !== null}>
      <h3>Steps tonight</h3>
      {state.phase === "counting" && !mine ? (
        <>
          <p className="outingSteps__muted">You&apos;re counting steps for another night. Stop that one to count this one.</p>
          <div className="outingSteps__actions">{stopButton}</div>
        </>
      ) : state.phase === "counting" ? (
        <>
          <p className="outingSteps__count">{stepCount(state.steps, state.gap)}</p>
          <p className="outingSteps__muted">
            Counted by your phone since {clock(state.startedAt)}. Counting stops by itself at {clock(state.startedAt + OUTING_STEPS_MAX_MS)}.
          </p>
          {state.counter ? <p className="outingSteps__muted">Some phones miss steps while this app is closed.</p> : null}
          {denied ? <p role="status">Step counting is blocked for this app. {settings}</p> : null}
          <div className="outingSteps__actions">{stopButton}</div>
        </>
      ) : state.phase === "stopped" && mine ? (
        <>
          <p className="outingSteps__count">{stepCount(state.steps, state.gap)}</p>
          <p className="outingSteps__muted">Counted by your phone from {clock(state.startedAt)} to {clock(state.endedAt)}. Only you can see this.</p>
          <div className="outingSteps__actions">
            <Button variant="ghost" onClick={() => apply({ type: "clear" })}>Clear</Button>
          </div>
        </>
      ) : (
        <>
          <p className="outingSteps__muted">
            Count the steps you actually walk tonight with your phone&apos;s step counter. Only you see the count, and it stays on this phone.
          </p>
          {busy === "asking" ? <p role="status">Waiting for your phone to say yes.</p> : null}
          {denied ? <p role="status">Step counting is blocked for this app. {settings}</p> : null}
          <div className="outingSteps__actions">
            <Button variant="secondary" disabled={busy !== null} onClick={() => void start()}>
              {denied ? "Try again" : "Count my steps"}
            </Button>
          </div>
        </>
      )}
      {problem ? <p role="alert">{problem}</p> : null}
    </section>
  );
}
