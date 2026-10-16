// SYNTHETIC FIXTURES AND A SCRIPTED ADAPTER FOR THE LOCAL VOICE TRIAL HARNESS.
//
// Every venue here is made up and says so, and none carries a price, an hour
// or an address, so nothing in a fixture run can be mistaken for a pub fact.
// The audio chunks are a few zero bytes standing in for "a chunk arrived":
// they are not decodable audio and no fixture run plays sound.
//
// The scripted adapter emits each step after its offset through the scheduler
// it is handed. With `honourAbort: false` it keeps emitting after the harness
// aborts its turn, which is how a test proves the harness drops stale output
// on its own instead of relying on the adapter to stop.

export const FIXTURE_VENUES = Object.freeze([
  Object.freeze({ fixtureId: "fixture-venue-a", label: "Synthetic Venue A", synthetic: true }),
  Object.freeze({ fixtureId: "fixture-venue-b", label: "Synthetic Venue B", synthetic: true }),
]);

export const FIXTURE_IDS = Object.freeze(FIXTURE_VENUES.map((venue) => venue.fixtureId));

const chunk = () => new Uint8Array(4);

/** Utterance key to ordered steps. `after` is an offset in the scheduler's units. */
export const FIXTURE_SCRIPTS = Object.freeze({
  "fixture: somewhere quiet": [
    { after: 1, event: { type: "text", text: " " } },
    { after: 2, event: { type: "text", text: "Checking the fixture list." } },
    { after: 3, event: { type: "tool", callId: "call-1", fixtureId: "fixture-venue-a", output: FIXTURE_VENUES[0] } },
    { after: 4, event: { type: "audio", chunk: chunk() } },
    { after: 5, event: { type: "text", text: "Synthetic Venue A is the fixture answer." } },
    { after: 6, event: { type: "audio", chunk: chunk() } },
    { after: 7, event: { type: "done" } },
  ],
  "fixture: slow tool": [
    { after: 1, event: { type: "text", text: "Looking." } },
    { after: 10, event: { type: "tool", callId: "call-slow", fixtureId: "fixture-venue-b", output: FIXTURE_VENUES[1] } },
    { after: 11, event: { type: "audio", chunk: chunk() } },
    { after: 12, event: { type: "done" } },
  ],
});

/**
 * @param {{
 *   scripts?: Record<string, readonly { after: number, event: unknown }[]>,
 *   schedule: (run: () => void, after: number) => void,
 *   honourAbort?: boolean,
 * }} options
 */
export function createScriptedAdapter({ scripts = FIXTURE_SCRIPTS, schedule, honourAbort = true }) {
  return {
    startTurn({ utterance, signal, emit }) {
      const steps = scripts[utterance];
      if (!steps) throw new Error(`local voice trial: no fixture script for ${JSON.stringify(utterance)}`);
      for (const step of steps) {
        schedule(() => {
          if (honourAbort && signal.aborted) return;
          emit(step.event);
        }, step.after);
      }
    },
  };
}
