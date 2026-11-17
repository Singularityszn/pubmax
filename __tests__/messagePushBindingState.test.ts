import { describe, expect, it } from "vitest";

import {
  INITIAL_MESSAGE_PUSH_BINDING_STATE,
  transitionMessagePushBinding,
  type MessagePushBinding,
  type MessagePushBindingEvent,
  type MessagePushBindingState,
  type MessagePushBindingEffect,
} from "@/lib/messagePushBindingState";

const a: MessagePushBinding = { token: "device-a", sessionId: "session-a" };
const b: MessagePushBinding = { token: "device-a", sessionId: "session-b" };
const c: MessagePushBinding = { token: "device-c", sessionId: "session-c" };
const unbound: MessagePushBindingState = { phase: "unbound", revision: 3, pending: [] };
const bound: MessagePushBindingState = { phase: "bound", revision: 3, binding: b, pending: [a] };
const departing: MessagePushBindingState = { phase: "departing", revision: 4, pending: [a] };
const pending: MessagePushBindingState = { phase: "pending-release", revision: 4, pending: [a, c] };

describe("private push binding transitions", () => {
  it.each([unbound, bound, departing, pending])("preserves identity for unchanged storage results and release hydration: $phase", state => {
    expect(transitionMessagePushBinding(state, { type: "storage-result", target: "binding", saved: true }).state).toBe(state);
    expect(transitionMessagePushBinding(state, { type: "releases-loaded", bindings: state.pending.map(binding => ({ ...binding })) }).state).toBe(state);
    const dirty = { ...state, unsaved: ["releases"] as const };
    expect(transitionMessagePushBinding(dirty, { type: "storage-result", target: "releases", saved: false }).state).toBe(dirty);
  });
  it("keeps an unpersisted departure authoritative over readable empty storage", () => {
    let state = transitionMessagePushBinding(bound, { type: "departure-started", storedBinding: b, storedReleases: [] }).state;
    state = transitionMessagePushBinding(state, { type: "storage-result", target: "releases", saved: false }).state;
    state = transitionMessagePushBinding(state, { type: "releases-loaded", bindings: [] }).state;
    expect(state.pending).toEqual([b]);
    state = transitionMessagePushBinding(state, { type: "binding-recorded", token: c.token, sessionId: c.sessionId, revision: state.revision, storedReleases: [] }).state;
    expect(state.pending).toEqual([b]);
  });
  it("keeps an accepted binding authoritative when its session marker cannot be written", () => {
    let state = transitionMessagePushBinding(unbound, { type: "binding-recorded", token: b.token, sessionId: b.sessionId, revision: 3 }).state;
    state = transitionMessagePushBinding(state, { type: "storage-result", target: "binding", saved: false }).state;
    state = transitionMessagePushBinding(state, { type: "departure-started", storedBinding: null, storedReleases: [] }).state;
    expect(state.pending).toEqual([b]);
  });
  it("does not restore a superseded release after a failed rebind write", () => {
    let state = transitionMessagePushBinding(pending, { type: "binding-recorded", token: b.token, sessionId: b.sessionId, revision: 4 }).state;
    state = transitionMessagePushBinding(state, { type: "storage-result", target: "releases", saved: false }).state;
    state = transitionMessagePushBinding(state, { type: "releases-loaded", bindings: [a, c] }).state;
    expect(state).toMatchObject({ phase: "bound", binding: b, pending: [c] });
    state = transitionMessagePushBinding(state, { type: "release-confirmed", binding: c }).state;
    state = transitionMessagePushBinding(state, { type: "releases-loaded", bindings: [a, c] }).state;
    expect(state.pending).toEqual([]);
    state = transitionMessagePushBinding(state, { type: "storage-result", target: "releases", saved: true }).state;
    expect(state.unsaved).toBeUndefined();
  });
  it("does not compensate an old completion against the same current binding", () => {
    const state = { ...bound, pending: [] } as MessagePushBindingState;
    expect(transitionMessagePushBinding(state, { type: "binding-recorded", token: b.token, sessionId: b.sessionId, revision: 2 })).toEqual({ state, effects: [] });
  });
  it("starts with no account binding or release backlog", () => {
    expect(INITIAL_MESSAGE_PUSH_BINDING_STATE).toEqual({ phase: "unbound", revision: 0, pending: [] });
  });
  const transitions: {
    name: string;
    state: MessagePushBindingState;
    event: MessagePushBindingEvent;
    next: MessagePushBindingState;
    effects: MessagePushBindingEffect[];
  }[] = [
    {
      name: "binds an unbound device and retains another device's pending detach",
      state: unbound,
      event: { type: "binding-recorded", token: a.token, sessionId: a.sessionId, revision: 3, storedReleases: [c] },
      next: { phase: "bound", revision: 3, binding: a, pending: [c] },
      effects: ["persist-binding", "persist-releases"],
    },
    {
      name: "a current bind supersedes every older detach for that token",
      state: bound,
      event: { type: "binding-recorded", token: b.token, sessionId: b.sessionId, revision: 3, storedReleases: [a, c] },
      next: { phase: "bound", revision: 3, binding: b, pending: [c] },
      effects: ["persist-binding", "persist-releases"],
    },
    {
      name: "a refused current binding leaves other devices pending",
      state: bound,
      event: { type: "binding-recorded", token: b.token, sessionId: null, revision: 3, storedReleases: [a, c] },
      next: { phase: "pending-release", revision: 3, pending: [c] },
      effects: ["persist-binding", "persist-releases"],
    },
    {
      name: "a stale accepted bind queues compensation without replacing the current binding",
      state: { phase: "bound", revision: 3, binding: b, pending: [] },
      event: { type: "binding-recorded", token: a.token, sessionId: a.sessionId, revision: 2, storedReleases: [c] },
      next: { phase: "bound", revision: 3, binding: b, pending: [c, a] },
      effects: ["persist-releases"],
    },
    {
      name: "a late bind during departure preserves both session releases",
      state: departing,
      event: { type: "binding-recorded", token: b.token, sessionId: b.sessionId, revision: 3 },
      next: { phase: "departing", revision: 4, pending: [a, b] },
      effects: ["persist-releases"],
    },
    {
      name: "deduplicates persisted releases by token and session",
      state: unbound,
      event: { type: "releases-loaded", bindings: [a, c, a] },
      next: { phase: "pending-release", revision: 3, pending: [a, c] },
      effects: [],
    },
    {
      name: "hydration cannot erase an active binding",
      state: bound,
      event: { type: "releases-loaded", bindings: [] },
      next: { phase: "bound", revision: 3, binding: b, pending: [] },
      effects: [],
    },
    {
      name: "hydration keeps departure active",
      state: departing,
      event: { type: "releases-loaded", bindings: [c] },
      next: { phase: "departing", revision: 4, pending: [c] },
      effects: [],
    },
    {
      name: "an empty persisted backlog returns to unbound",
      state: pending,
      event: { type: "releases-loaded", bindings: [] },
      next: { phase: "unbound", revision: 4, pending: [] },
      effects: [],
    },
    {
      name: "departure increments the scope and queues the active binding",
      state: bound,
      event: { type: "departure-started", storedBinding: undefined, storedReleases: [c] },
      next: { phase: "departing", revision: 4, pending: [c, b] },
      effects: ["announce-departure", "persist-releases", "persist-binding"],
    },
    {
      name: "a cleared session marker prevents detaching a stale in-memory binding",
      state: { phase: "bound", revision: 3, binding: b, pending: [] },
      event: { type: "departure-started", storedBinding: null, storedReleases: [c] },
      next: { phase: "departing", revision: 4, pending: [] },
      effects: ["announce-departure", "persist-binding"],
    },
    {
      name: "a reload recovers the persisted binding for departure",
      state: unbound,
      event: { type: "departure-started", storedBinding: a, storedReleases: [c] },
      next: { phase: "departing", revision: 4, pending: [c, a] },
      effects: ["announce-departure", "persist-releases", "persist-binding"],
    },
    {
      name: "another departure fences the previous one",
      state: departing,
      event: { type: "departure-started", storedBinding: undefined },
      next: { phase: "departing", revision: 5, pending: [a] },
      effects: ["announce-departure", "persist-binding"],
    },
    {
      name: "completed departure retains offline releases",
      state: departing,
      event: { type: "departure-settled", revision: 4 },
      next: { phase: "pending-release", revision: 4, pending: [a] },
      effects: [],
    },
    {
      name: "completed departure with no backlog is unbound",
      state: { phase: "departing", revision: 4, pending: [] },
      event: { type: "departure-settled", revision: 4 },
      next: { phase: "unbound", revision: 4, pending: [] },
      effects: [],
    },
    {
      name: "a release acknowledgement removes only its exact binding",
      state: pending,
      event: { type: "release-confirmed", binding: a },
      next: { phase: "pending-release", revision: 4, pending: [c] },
      effects: ["persist-releases"],
    },
    {
      name: "an old release acknowledgement preserves a newer active binding",
      state: bound,
      event: { type: "release-confirmed", binding: a },
      next: { phase: "bound", revision: 3, binding: b, pending: [] },
      effects: ["persist-releases"],
    },
    {
      name: "the final release clears the backlog",
      state: { phase: "pending-release", revision: 4, pending: [a] },
      event: { type: "release-confirmed", binding: a },
      next: { phase: "unbound", revision: 4, pending: [] },
      effects: ["persist-releases"],
    },
  ];
  it.each(transitions)("$name", ({ state, event, next, effects }) => {
    const beforeState = structuredClone(state);
    const beforeEvent = structuredClone(event);
    expect(transitionMessagePushBinding(state, event)).toEqual({ state: next, effects });
    expect(state).toEqual(beforeState);
    expect(event).toEqual(beforeEvent);
  });
  it.each([
    { state: bound, event: { type: "binding-recorded", token: a.token, sessionId: null, revision: 2 } },
    { state: pending, event: { type: "release-confirmed", binding: b } },
    { state: departing, event: { type: "departure-settled", revision: 3 } },
    { state: bound, event: { type: "departure-settled", revision: 3 } },
  ] satisfies { state: MessagePushBindingState; event: MessagePushBindingEvent }[])("refuses an obsolete or unrelated $event.type", ({ state, event }) => {
    const result = transitionMessagePushBinding(state, event);
    expect(result.state).toBe(state);
    expect(result.effects).toEqual([]);
  });
});
