// The local voice trial harness is fixture-only. These tests pin what it must
// get right before any real local model is put behind it: turn ownership,
// stale-output drops after a cancel or a newer turn, the four separate timing
// marks, and the loopback-only endpoint guard. No microphone, provider,
// network or model is touched; the clock and the scheduler are hand-driven.
import { describe, expect, it } from "vitest";

import {
  assertLoopbackEndpoint,
  createTrialSession,
  summariseTrial,
  type TrialEvent,
  type TrialLogEntry,
  type TrialTurn,
  type TurnSummary,
} from "../scripts/pubpal/local-voice-trial/harness.mjs";
import {
  createScriptedAdapter,
  FIXTURE_IDS,
  FIXTURE_SCRIPTS,
  FIXTURE_VENUES,
} from "../scripts/pubpal/local-voice-trial/fixtures.mjs";

function manualClock() {
  let time = 0;
  let seq = 0;
  const queue: { at: number; seq: number; run: () => void }[] = [];
  return {
    now: () => time,
    schedule: (run: () => void, after: number) => {
      queue.push({ at: time + after, seq: seq++, run });
    },
    advanceTo(target: number) {
      for (;;) {
        queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
        const next = queue[0];
        if (!next || next.at > target) break;
        queue.shift();
        time = next.at;
        next.run();
      }
      time = target;
    },
  };
}

function captureAdapter() {
  const turns: TrialTurn[] = [];
  return { adapter: { startTurn: (turn: TrialTurn) => void turns.push(turn) }, turns };
}

function turnOf(summaries: TurnSummary[], turnId: string): TurnSummary {
  const found = summaries.find((summary) => summary.turnId === turnId);
  if (!found) throw new Error(`no summary for ${turnId}`);
  return found;
}

const marks = (log: TrialLogEntry[], turnId: string) =>
  log.flatMap((entry) => (entry.kind === "mark" && entry.turnId === turnId ? [`${entry.mark}@${entry.at}`] : []));

const drops = (log: TrialLogEntry[]) =>
  log.flatMap((entry) => (entry.kind === "dropped" ? [`${entry.turnId}:${String(entry.type)}:${entry.reason}`] : []));

describe("event ordering and the four marks", () => {
  it("records first useful text, first audio and completion as separate readings", () => {
    const clock = manualClock();
    const delivered: string[] = [];
    const session = createTrialSession({
      adapter: createScriptedAdapter({ schedule: clock.schedule }),
      fixtureIds: FIXTURE_IDS,
      now: clock.now,
      onDeliver: (turnId, event) => delivered.push(`${turnId}:${event.type}`),
    });

    const turnId = session.startTurn("fixture: somewhere quiet");
    clock.advanceTo(20);
    const log = session.log();

    // The blank chunk at 1 is delivered but is not useful text.
    expect(marks(log, turnId)).toEqual(["turn_started@0", "first_text@2", "first_audio@4", "completed@7"]);
    expect(delivered).toEqual([
      "turn-1:text",
      "turn-1:text",
      "turn-1:tool",
      "turn-1:audio",
      "turn-1:text",
      "turn-1:audio",
    ]);
    expect(drops(log)).toEqual([]);
    expect(session.activeTurn()).toBeNull();

    const summary = turnOf(summariseTrial(log), turnId);
    expect(summary.sinceStart).toEqual({ first_text: 2, first_audio: 4, completed: 7, cancelled: null });
    expect(summary.cancelCause).toBeNull();
  });

  it("summarises a mark that never happened as null, never zero", () => {
    const { adapter } = captureAdapter();
    const session = createTrialSession({ adapter, fixtureIds: FIXTURE_IDS, now: () => 5 });
    const turnId = session.startTurn("anything");

    const summary = turnOf(summariseTrial(session.log()), turnId);
    expect(summary.marks).toEqual({
      turn_started: 5,
      first_text: null,
      first_audio: null,
      completed: null,
      cancelled: null,
    });
    expect(summary.sinceStart).toEqual({ first_text: null, first_audio: null, completed: null, cancelled: null });
    expect(summary.delivered).toBe(0);
  });

  it("refuses to run without an explicit clock", () => {
    const { adapter } = captureAdapter();
    expect(() =>
      createTrialSession({ adapter, fixtureIds: FIXTURE_IDS, now: undefined as unknown as () => number }),
    ).toThrow(/clock/);
  });
});

describe("cancellation", () => {
  it("drops everything a cancelled turn still emits, even from an adapter that ignores the abort", () => {
    const clock = manualClock();
    const delivered: string[] = [];
    const session = createTrialSession({
      adapter: createScriptedAdapter({ schedule: clock.schedule, honourAbort: false }),
      fixtureIds: FIXTURE_IDS,
      now: clock.now,
      onDeliver: (turnId, event) => delivered.push(`${turnId}:${event.type}`),
    });

    const turnId = session.startTurn("fixture: somewhere quiet");
    clock.advanceTo(3);
    expect(session.cancel()).toBe(true);
    clock.advanceTo(20);
    const log = session.log();

    expect(delivered).toEqual(["turn-1:text", "turn-1:text", "turn-1:tool"]);
    expect(drops(log)).toEqual([
      "turn-1:audio:cancelled",
      "turn-1:text:cancelled",
      "turn-1:audio:cancelled",
      "turn-1:done:cancelled",
    ]);
    expect(marks(log, turnId)).toEqual(["turn_started@0", "first_text@2", "cancelled@3"]);

    const summary = turnOf(summariseTrial(log), turnId);
    expect(summary.cancelCause).toBe("user");
    expect(summary.sinceStart).toEqual({ first_text: 2, first_audio: null, completed: null, cancelled: 3 });
  });

  it("aborts the turn's signal so a well-behaved adapter stops on its own", () => {
    const clock = manualClock();
    const { adapter, turns } = captureAdapter();
    const session = createTrialSession({ adapter, fixtureIds: FIXTURE_IDS, now: clock.now });

    session.startTurn("anything");
    const turn = turns[0]!;
    expect(turn.signal.aborted).toBe(false);
    session.cancel();
    expect(turn.signal.aborted).toBe(true);
  });

  it("is a no-op when nothing is open, and never marks a turn cancelled twice", () => {
    const { adapter, turns } = captureAdapter();
    const session = createTrialSession({ adapter, fixtureIds: FIXTURE_IDS, now: () => 0 });

    expect(session.cancel()).toBe(false);
    const first = session.startTurn("anything");
    turns[0]!.emit({ type: "done" });
    expect(session.cancel()).toBe(false);

    const second = session.startTurn("anything");
    expect(session.cancel()).toBe(true);
    expect(session.cancel()).toBe(false);

    const log = session.log();
    expect(marks(log, first)).toEqual(["turn_started@0", "completed@0"]);
    expect(marks(log, second)).toEqual(["turn_started@0", "cancelled@0"]);
  });
});

describe("turn ownership", () => {
  it("drops a superseded turn's late tool completion and plays only the newer turn", () => {
    const clock = manualClock();
    const delivered: string[] = [];
    const session = createTrialSession({
      adapter: createScriptedAdapter({ schedule: clock.schedule, honourAbort: false }),
      fixtureIds: FIXTURE_IDS,
      now: clock.now,
      onDeliver: (turnId, event) => delivered.push(`${turnId}:${event.type}`),
    });

    const older = session.startTurn("fixture: slow tool");
    clock.advanceTo(2);
    const newer = session.startTurn("fixture: somewhere quiet");
    clock.advanceTo(30);
    const log = session.log();

    expect(marks(log, older)).toEqual(["turn_started@0", "first_text@1", "cancelled@2"]);
    expect(marks(log, newer)).toEqual(["turn_started@2", "first_text@4", "first_audio@6", "completed@9"]);
    expect(drops(log)).toEqual(["turn-1:tool:superseded", "turn-1:audio:superseded", "turn-1:done:superseded"]);
    expect(delivered.filter((entry) => entry.startsWith("turn-1:"))).toEqual(["turn-1:text"]);
    expect(turnOf(summariseTrial(log), older).cancelCause).toBe("superseded");
    expect(session.activeTurn()).toBeNull();
  });

  it("binds an event to the turn whose emit sent it, not to whatever turn is open", () => {
    const { adapter, turns } = captureAdapter();
    const delivered: string[] = [];
    const session = createTrialSession({
      adapter,
      fixtureIds: FIXTURE_IDS,
      now: () => 0,
      onDeliver: (turnId) => delivered.push(turnId),
    });

    session.startTurn("first");
    session.startTurn("second");
    turns[0]!.emit({ type: "text", text: "late words from the old turn" });
    turns[1]!.emit({ type: "text", text: "the current turn" });

    expect(delivered).toEqual(["turn-2"]);
    expect(drops(session.log())).toEqual(["turn-1:text:superseded"]);
  });

  it("drops output that arrives after its own turn completed", () => {
    const { adapter, turns } = captureAdapter();
    const session = createTrialSession({ adapter, fixtureIds: FIXTURE_IDS, now: () => 0 });

    const turnId = session.startTurn("anything");
    const turn = turns[0]!;
    turn.emit({ type: "done" });
    turn.emit({ type: "audio", chunk: new Uint8Array(4) });
    turn.emit({ type: "done" });

    const log = session.log();
    expect(drops(log)).toEqual(["turn-1:audio:after_completion", "turn-1:done:after_completion"]);
    expect(marks(log, turnId)).toEqual(["turn_started@0", "completed@0"]);
  });
});

describe("abort callbacks run after ownership is settled", () => {
  // An adapter's abort listener runs synchronously inside the harness's
  // controller.abort(). These pin what such a listener can and cannot do.

  const cancelledMarks = (log: TrialLogEntry[], turnId: string) =>
    log.filter((entry) => entry.kind === "mark" && entry.turnId === turnId && entry.mark === "cancelled").length;

  it("lets a superseded turn's abort listener start a turn without throwing, and only the current turn plays", () => {
    const { adapter, turns } = captureAdapter();
    const delivered: { turnId: string; type: string; active: string | null }[] = [];
    // onDeliver only runs after the session exists, so it may read it.
    const session = createTrialSession({
      adapter,
      fixtureIds: FIXTURE_IDS,
      now: () => 0,
      onDeliver: (turnId, event) => delivered.push({ turnId, type: event.type, active: session.activeTurn() }),
    });

    const first = session.startTurn("first");
    const fromListener: string[] = [];
    // No try/catch: a throw here would surface as an uncaught exception.
    turns[0]!.signal.addEventListener("abort", () => void fromListener.push(session.startTurn("from the listener")), {
      once: true,
    });

    const outer = session.startTurn("outer");

    expect(fromListener).toHaveLength(1);
    const current = session.activeTurn();
    expect(current).not.toBeNull();
    expect([outer, fromListener[0]]).toContain(current);

    // Exactly one turn the adapter was handed is still live, and it is current.
    const live = turns.filter((turn) => !turn.signal.aborted);
    expect(live.map((turn) => turn.turnId)).toEqual([current]);
    const log = session.log();
    for (const id of new Set([first, outer, fromListener[0]!])) {
      expect(cancelledMarks(log, id)).toBe(id === current ? 0 : 1);
    }

    const venue = FIXTURE_VENUES[0]!;
    for (const turn of turns.filter((candidate) => candidate.turnId !== current)) {
      turn.emit({ type: "text", text: "stale words" });
      turn.emit({ type: "audio", chunk: new Uint8Array([7]) });
      turn.emit({ type: "tool", callId: "call-stale", fixtureId: venue.fixtureId, output: venue });
      turn.emit({ type: "done" });
    }
    expect(session.activeTurn()).toBe(current);

    const currentTurn = live[0]!;
    currentTurn.emit({ type: "text", text: "current words" });
    currentTurn.emit({ type: "audio", chunk: new Uint8Array([1]) });
    currentTurn.emit({ type: "tool", callId: "call-current", fixtureId: venue.fixtureId, output: venue });
    currentTurn.emit({ type: "done" });

    expect(delivered).toEqual([
      { turnId: current, type: "text", active: current },
      { turnId: current, type: "audio", active: current },
      { turnId: current, type: "tool", active: current },
    ]);
    expect(drops(session.log())).toEqual([
      `${first}:text:superseded`,
      `${first}:audio:superseded`,
      `${first}:tool:superseded`,
      `${first}:done:superseded`,
    ]);
    expect(session.activeTurn()).toBeNull();
    expect(turnOf(summariseTrial(session.log()), first).cancelCause).toBe("superseded");
  });

  it("ends when every turn's abort listener starts another turn, leaving one live turn per start", () => {
    const turns: TrialTurn[] = [];
    // The adapter only calls back into the session after it exists.
    const session = createTrialSession({
      adapter: {
        startTurn(turn: TrialTurn) {
          turns.push(turn);
          turn.signal.addEventListener("abort", () => void session.startTurn(`follow-up to ${turn.turnId}`), {
            once: true,
          });
        },
      },
      fixtureIds: FIXTURE_IDS,
      now: () => 0,
    });

    for (const utterance of ["one", "two", "three"]) {
      session.startTurn(utterance);
      const live = turns.filter((turn) => !turn.signal.aborted).map((turn) => turn.turnId);
      expect(live).toEqual([session.activeTurn()]);
    }
    // Each start aborts one handed-over turn, whose listener starts exactly one more.
    expect(turns).toHaveLength(3);
  });

  it("lets a later listener cancel the turn an earlier listener started, leaving nothing open", () => {
    const { adapter, turns } = captureAdapter();
    const session = createTrialSession({ adapter, fixtureIds: FIXTURE_IDS, now: () => 0 });

    const first = session.startTurn("first");
    const started: string[] = [];
    const cancelled: boolean[] = [];
    turns[0]!.signal.addEventListener("abort", () => void started.push(session.startTurn("from the first listener")));
    turns[0]!.signal.addEventListener("abort", () => void cancelled.push(session.cancel()));

    const outer = session.startTurn("outer");

    expect(started).toHaveLength(1);
    expect(cancelled).toEqual([true]);
    expect(session.activeTurn()).toBeNull();
    expect(turns.every((turn) => turn.signal.aborted)).toBe(true);
    const log = session.log();
    for (const id of new Set([first, outer, started[0]!])) expect(cancelledMarks(log, id)).toBe(1);
    expect(turnOf(summariseTrial(log), started[0]!).cancelCause).toBe("user");
  });

  it("drops what a listener emits during a user cancel, and a cancel from it finds nothing open", () => {
    const { adapter, turns } = captureAdapter();
    const delivered: string[] = [];
    const session = createTrialSession({
      adapter,
      fixtureIds: FIXTURE_IDS,
      now: () => 0,
      onDeliver: (turnId, event) => delivered.push(`${turnId}:${event.type}`),
    });

    const turnId = session.startTurn("anything");
    const seen: { active: string | null; cancelled: boolean }[] = [];
    turns[0]!.signal.addEventListener("abort", () => {
      turns[0]!.emit({ type: "text", text: "said while being cancelled" });
      seen.push({ active: session.activeTurn(), cancelled: session.cancel() });
    });

    expect(session.cancel()).toBe(true);

    expect(seen).toEqual([{ active: null, cancelled: false }]);
    expect(delivered).toEqual([]);
    const log = session.log();
    expect(drops(log)).toEqual([`${turnId}:text:cancelled`]);
    expect(marks(log, turnId)).toEqual(["turn_started@0", "cancelled@0"]);
  });

  it("lets a listener on a user cancel start the next turn, which then owns delivery", () => {
    const { adapter, turns } = captureAdapter();
    const delivered: string[] = [];
    const session = createTrialSession({
      adapter,
      fixtureIds: FIXTURE_IDS,
      now: () => 0,
      onDeliver: (turnId, event) => delivered.push(`${turnId}:${event.type}`),
    });

    const first = session.startTurn("first");
    const started: string[] = [];
    turns[0]!.signal.addEventListener("abort", () => void started.push(session.startTurn("after the cancel")), {
      once: true,
    });

    expect(session.cancel()).toBe(true);
    expect(started).toHaveLength(1);
    const next = started[0]!;
    expect(session.activeTurn()).toBe(next);

    turns[0]!.emit({ type: "text", text: "late" });
    turns[1]!.emit({ type: "text", text: "next" });

    expect(delivered).toEqual([`${next}:text`]);
    expect(drops(session.log())).toEqual([`${first}:text:cancelled`]);
    expect(turns[1]!.signal.aborted).toBe(false);
  });
});

describe("what the session hands an adapter", () => {
  it("calls the adapter once per started turn with only the turn id, utterance, signal and emit", () => {
    const { adapter, turns } = captureAdapter();
    const session = createTrialSession({ adapter, fixtureIds: FIXTURE_IDS, now: () => 0 });

    expect(turns).toEqual([]);
    const first = session.startTurn("one");
    const second = session.startTurn("two");

    expect(turns.map((turn) => Object.keys(turn).sort())).toEqual([
      ["emit", "signal", "turnId", "utterance"],
      ["emit", "signal", "turnId", "utterance"],
    ]);
    expect(turns.map((turn) => [turn.turnId, turn.utterance])).toEqual([
      [first, "one"],
      [second, "two"],
    ]);
    expect(turns[0]!.signal).not.toBe(turns[1]!.signal);
  });
});

describe("grounding and the closed event vocabulary", () => {
  it("drops a tool result naming no fixture, and malformed events", () => {
    const { adapter, turns } = captureAdapter();
    const delivered: string[] = [];
    const session = createTrialSession({
      adapter,
      fixtureIds: FIXTURE_IDS,
      now: () => 0,
      onDeliver: (_turnId, event) => delivered.push(event.type),
    });

    session.startTurn("anything");
    const emit = turns[0]!.emit as (event: unknown) => void;
    emit({ type: "tool", callId: "call-x", fixtureId: "not-a-fixture", output: {} });
    emit({ type: "tool", fixtureId: FIXTURE_IDS[0], output: {} });
    emit({ type: "audio", chunk: new Uint8Array(0) });
    emit({ type: "transcript", text: "outside the vocabulary" });
    emit(null);
    emit({ type: "tool", callId: "call-ok", fixtureId: "fixture-venue-a", output: FIXTURE_VENUES[0] } satisfies TrialEvent);

    expect(drops(session.log())).toEqual([
      "turn-1:tool:ungrounded",
      "turn-1:tool:malformed",
      "turn-1:audio:malformed",
      "turn-1:transcript:malformed",
      "turn-1:undefined:malformed",
    ]);
    expect(delivered).toEqual(["tool"]);
  });

  it("keeps every fixture visibly synthetic and free of prices, hours and addresses", () => {
    for (const venue of FIXTURE_VENUES) {
      expect(venue.synthetic).toBe(true);
      expect(Object.keys(venue).sort()).toEqual(["fixtureId", "label", "synthetic"]);
      expect(venue.label).toMatch(/^Synthetic /);
    }
    for (const steps of Object.values(FIXTURE_SCRIPTS)) {
      for (const step of steps) {
        const event = step.event as { type?: string; fixtureId?: string };
        if (event.type === "tool") expect(FIXTURE_IDS).toContain(event.fixtureId);
      }
    }
  });
});

describe("the loopback-only boundary", () => {
  it("accepts an explicit port on a literal loopback address", () => {
    expect(assertLoopbackEndpoint({ host: "127.0.0.1", port: 8765 })).toEqual({ host: "127.0.0.1", port: 8765 });
    expect(assertLoopbackEndpoint({ host: "::1", port: 8765 })).toEqual({ host: "::1", port: 8765 });
  });

  it.each([
    { host: "0.0.0.0", port: 8765 },
    { host: "::", port: 8765 },
    { host: "localhost", port: 8765 },
    { host: "192.168.1.10", port: 8765 },
    { host: "127.0.0.1" },
    { host: "127.0.0.1", port: 0 },
    { host: "127.0.0.1", port: 80 },
    { host: "127.0.0.1", port: "8765" },
    { host: "127.0.0.1", port: 70000 },
  ])("refuses %o", (endpoint) => {
    expect(() => assertLoopbackEndpoint(endpoint)).toThrow(/local voice trial/);
  });

  it("refuses a session whose adapter declares a non-loopback endpoint", () => {
    const startTurn = () => {};
    expect(() =>
      createTrialSession({
        adapter: { endpoint: { host: "0.0.0.0", port: 8765 } as never, startTurn },
        fixtureIds: FIXTURE_IDS,
        now: () => 0,
      }),
    ).toThrow(/127\.0\.0\.1/);
    expect(() =>
      createTrialSession({
        adapter: { endpoint: { host: "127.0.0.1", port: 8765 }, startTurn },
        fixtureIds: FIXTURE_IDS,
        now: () => 0,
      }),
    ).not.toThrow();
  });
});
