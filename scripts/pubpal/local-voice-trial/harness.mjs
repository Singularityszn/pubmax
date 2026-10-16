// Disposable synthetic voice trial harness.
// See docs/PUB_PAL_LOCAL_VOICE_TRIAL.md for the contract and fixture proof limits.

/** The closed set of timing marks. */
export const TRIAL_MARKS = Object.freeze(["turn_started", "first_text", "first_audio", "completed", "cancelled"]);

/** The closed set of reasons an adapter event is dropped instead of played. */
export const DROP_REASONS = Object.freeze(["cancelled", "superseded", "after_completion", "ungrounded", "malformed"]);

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1"]);

/**
 * The endpoint a later local adapter may talk to: an explicit port on a
 * literal loopback address. `localhost` is refused because it is a name a
 * resolver answers, and `0.0.0.0` or `::` binds every interface.
 *
 * @param {{ host?: unknown, port?: unknown } | null | undefined} endpoint
 * @returns {{ host: string, port: number }}
 */
export function assertLoopbackEndpoint(endpoint) {
  const host = endpoint?.host;
  const port = endpoint?.port;
  if (typeof host !== "string" || !LOOPBACK_HOSTS.has(host)) {
    throw new Error(`local voice trial: host must be 127.0.0.1 or ::1, got ${JSON.stringify(host)}`);
  }
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`local voice trial: port must be an explicit integer from 1024 to 65535, got ${JSON.stringify(port)}`);
  }
  return { host, port };
}

/** @param {unknown} event @param {ReadonlySet<string>} fixtureIds */
function rejectReason(event, fixtureIds) {
  if (!event || typeof event !== "object") return "malformed";
  switch (event.type) {
    case "text":
      return typeof event.text === "string" ? null : "malformed";
    case "audio":
      return event.chunk instanceof Uint8Array && event.chunk.byteLength > 0 ? null : "malformed";
    case "tool":
      if (typeof event.callId !== "string") return "malformed";
      return typeof event.fixtureId === "string" && fixtureIds.has(event.fixtureId) ? null : "ungrounded";
    case "done":
      return null;
    default:
      return "malformed";
  }
}

/**
 * @param {{
 *   adapter: { endpoint?: { host: string, port: number }, startTurn: (turn: { turnId: string, utterance: string, signal: AbortSignal, emit: (event: unknown) => void }) => void },
 *   fixtureIds: Iterable<string>,
 *   now: () => number,
 *   onDeliver?: (turnId: string, event: unknown) => void,
 * }} options
 */
export function createTrialSession({ adapter, fixtureIds, now, onDeliver = () => {} }) {
  if (typeof now !== "function") throw new Error("local voice trial: pass the clock explicitly");
  if (adapter.endpoint !== undefined) assertLoopbackEndpoint(adapter.endpoint);
  const grounded = new Set(fixtureIds);
  /** @type {object[]} */
  const log = [];
  /** @type {Map<string, { controller: AbortController, state: "open" | "done" | "cancelled", cause?: string, sawText: boolean, sawAudio: boolean }>} */
  const turns = new Map();
  let active = null;
  let counter = 0;
  /** A turn startTurn has claimed but not yet handed to the adapter, else null. */
  let pending = null;

  const mark = (turnId, name, extra = {}) => log.push({ kind: "mark", turnId, mark: name, at: now(), ...extra });

  // Ownership is settled BEFORE the abort: an adapter's abort listener runs
  // synchronously inside controller.abort(), so a listener that emits, cancels
  // or starts a turn must already see this turn closed and no longer active.
  function end(turnId, cause) {
    const turn = turns.get(turnId);
    if (!turn || turn.state !== "open") return false;
    turn.state = "cancelled";
    turn.cause = cause;
    if (active === turnId) active = null;
    mark(turnId, "cancelled", { cause });
    turn.controller.abort();
    return true;
  }

  function receive(turnId, event) {
    const turn = turns.get(turnId);
    const type = event && typeof event === "object" ? event.type : undefined;
    let reason = null;
    if (turn.state === "cancelled") reason = turn.cause === "superseded" ? "superseded" : "cancelled";
    else if (turn.state === "done") reason = "after_completion";
    else reason = rejectReason(event, grounded);
    if (reason) {
      log.push({ kind: "dropped", turnId, type, reason, at: now() });
      return;
    }
    if (type === "done") {
      turn.state = "done";
      if (active === turnId) active = null;
      mark(turnId, "completed");
      return;
    }
    if (type === "text" && !turn.sawText && event.text.trim() !== "") {
      turn.sawText = true;
      mark(turnId, "first_text");
    }
    if (type === "audio" && !turn.sawAudio) {
      turn.sawAudio = true;
      mark(turnId, "first_audio");
    }
    log.push({ kind: "delivered", turnId, type, at: now() });
    onDeliver(turnId, event);
  }

  return {
    /**
     * Starts a turn, superseding any turn still open. The latest call owns the
     * session: the new turn is claimed first, then the open turn is ended, and
     * a start made from that turn's abort listeners is the later call, so it
     * supersedes the claimed turn before the adapter ever sees it.
     * @param {string} utterance
     */
    startTurn(utterance) {
      // A claimed turn the adapter has not been handed has no abort listeners,
      // so ending it runs no adapter code.
      if (pending) end(pending, "superseded");
      counter += 1;
      const turnId = `turn-${counter}`;
      const controller = new AbortController();
      const turn = { controller, state: "open", sawText: false, sawAudio: false };
      turns.set(turnId, turn);
      pending = turnId;
      mark(turnId, "turn_started");
      // The open turn's abort listeners run here and may start or cancel turns.
      if (active) end(active, "superseded");
      // A start from those listeners has already closed this turn.
      if (turn.state !== "open") return turnId;
      pending = null;
      active = turnId;
      adapter.startTurn({ turnId, utterance, signal: controller.signal, emit: (event) => receive(turnId, event) });
      return turnId;
    },
    /** Cancels the open turn. Answers false when nothing is open. */
    cancel() {
      return active ? end(active, "user") : false;
    },
    activeTurn: () => active,
    log: () => log.slice(),
  };
}

/**
 * Per-turn readings off the injected clock. A mark that never happened is
 * null, never zero, and a gap is only computed between two recorded marks.
 *
 * @param {readonly object[]} log
 */
export function summariseTrial(log) {
  /** @type {Map<string, any>} */
  const byTurn = new Map();
  for (const entry of log) {
    if (!byTurn.has(entry.turnId)) {
      byTurn.set(entry.turnId, {
        turnId: entry.turnId,
        marks: { turn_started: null, first_text: null, first_audio: null, completed: null, cancelled: null },
        cancelCause: null,
        delivered: 0,
        dropped: Object.fromEntries(DROP_REASONS.map((reason) => [reason, 0])),
      });
    }
    const turn = byTurn.get(entry.turnId);
    if (entry.kind === "mark" && turn.marks[entry.mark] === null) {
      turn.marks[entry.mark] = entry.at;
      if (entry.mark === "cancelled") turn.cancelCause = entry.cause;
    } else if (entry.kind === "delivered") turn.delivered += 1;
    else if (entry.kind === "dropped") turn.dropped[entry.reason] += 1;
  }
  const since = (start, at) => (start === null || at === null ? null : at - start);
  return [...byTurn.values()].map((turn) => ({
    ...turn,
    sinceStart: {
      first_text: since(turn.marks.turn_started, turn.marks.first_text),
      first_audio: since(turn.marks.turn_started, turn.marks.first_audio),
      completed: since(turn.marks.turn_started, turn.marks.completed),
      cancelled: since(turn.marks.turn_started, turn.marks.cancelled),
    },
  }));
}
