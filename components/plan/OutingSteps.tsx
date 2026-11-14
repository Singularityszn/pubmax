"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { loadOutingStepsBridge, type OutingStepsBridge, type OutingStepsStatus } from "@/lib/nativeOutingSteps";
import { nativePlatform } from "@/lib/nativePlatform";
import {
  OUTING_STEPS_MAX_MS,
  OUTING_STEPS_STORAGE_KEY,
  outingStepsWindow,
  parseOutingSteps,
  serializeOutingSteps,
  transitionOutingSteps,
  type OutingStepsState,
} from "@/lib/outingSteps";

import "./outingSteps.css";

const SAMPLE_MS = 30_000;

function readStored(): OutingStepsState {
  try {
    return parseOutingSteps(typeof window === "undefined" ? null : window.localStorage.getItem(OUTING_STEPS_STORAGE_KEY));
  } catch {
    return { phase: "off" };
  }
}

function clock(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }).format(new Date(ms));
}

function stepCount(steps: number, gap: boolean): string {
  return `${gap ? "At least " : ""}${steps.toLocaleString("en-GB")} ${steps === 1 ? "step" : "steps"}`;
}

const isAccessRefusal = (error: unknown) => {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "denied" || code === "unavailable";
};

/** Opt-in steps measured by this phone for one night. Native shell only. */
export default function OutingSteps({ planId }: { planId: string }) {
  const [bridge, setBridge] = useState<OutingStepsBridge | null>(null);
  const [status, setStatus] = useState<OutingStepsStatus | null>(null);
  const [state, dispatch] = useReducer(transitionOutingSteps, undefined, readStored);
  const [busy, setBusy] = useState<"asking" | "stopping" | null>(null);
  const [problem, setProblem] = useState("");
  const stateRef = useRef(state);
  const counting = state.phase === "counting" ? state.startedAt : null;

  useEffect(() => { stateRef.current = state; }, [state]);

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

  useEffect(() => {
    try {
      const raw = serializeOutingSteps(state);
      if (raw) window.localStorage.setItem(OUTING_STEPS_STORAGE_KEY, raw);
      else window.localStorage.removeItem(OUTING_STEPS_STORAGE_KEY);
    } catch { /* Storage can be full or blocked. The count still shows until the page closes. */ }
  }, [state]);

  const refuse = useCallback(async (active: OutingStepsBridge) => {
    const next = await active.status().catch(() => null);
    if (next) setStatus(next);
  }, []);

  const read = useCallback(async () => {
    const current = stateRef.current;
    const window = outingStepsWindow(current, Date.now());
    if (!bridge || !window || current.phase !== "counting") return;
    try {
      const sample = await bridge.sample(window);
      if (sample) dispatch({ type: "sample", startedAt: current.startedAt, at: Date.now(), sample });
      setProblem("");
    } catch (error) {
      if (isAccessRefusal(error)) await refuse(bridge);
      else setProblem("We couldn't read your steps just now. Your count so far is kept.");
    }
  }, [bridge, refuse]);

  useEffect(() => {
    if (!bridge) return;
    // Android keeps a sensor listener between readings. Release it whenever nothing is counting.
    if (counting === null) { void bridge.stop(); return; }
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
    try {
      let next = await bridge.status();
      if (next.available && next.permission === "prompt") next = await bridge.requestPermission();
      setStatus(next);
      if (!next.available || next.permission !== "granted") return;
      const at = Date.now();
      const sample = await bridge.sample({ since: at, until: at });
      if (!sample) throw new Error("unreadable");
      dispatch({ type: "start", planId, at, sample });
    } catch (error) {
      if (isAccessRefusal(error)) await refuse(bridge);
      else setProblem("We couldn't start counting. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function stop() {
    const current = stateRef.current;
    if (current.phase !== "counting") return;
    setBusy("stopping");
    await read();
    dispatch({ type: "stop", startedAt: current.startedAt, at: Date.now() });
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
            <Button variant="ghost" onClick={() => dispatch({ type: "clear" })}>Clear</Button>
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
