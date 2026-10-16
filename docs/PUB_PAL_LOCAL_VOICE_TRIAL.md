# Pub Pal local voice trial harness

A disposable synthetic harness for evaluating a future local, open-source voice loop before product integration. It lives in `scripts/pubpal/local-voice-trial/` and its tests are `__tests__/localVoiceTrial.test.ts`. No app route, component or library module currently imports it. The tests do not enforce that separation.

It is not a replacement for the shipped ElevenLabs voice, it is not wired to any Pub Pal route, provider, session, memory, tool or privacy module, and a pass here proves nothing about a real model, a real phone or a real voice.

## What it is

- `harness.mjs` runs turns against an adapter and owns three rules.
  - **Turn ownership.** The harness binds each `emit` closure to its original turn, regardless of any turn id an event claims. Once a turn is cancelled, superseded by a newer turn, or done, anything its `emit` still sends is dropped and logged with a reason (`cancelled`, `superseded`, `after_completion`). The harness aborts cancelled and superseded turns' `AbortSignal` objects. It does not rely on the adapter honouring them. A turn is closed, and stops being the active turn, before its abort runs, so anything an adapter's abort listener emits for that turn is dropped. The session permits abort listeners to call `startTurn` and `cancel()`. At most one turn is current (`activeTurn()`). Only that turn's text, audio and tool output reach the `onDeliver` callback. The harness does not play audio. While `startTurn` is handing over, the new turn is claimed but not yet current and not yet handed to the adapter, so it cannot deliver anything. A turn that is superseded or cancelled gets one `cancelled` mark and an aborted signal. A turn that finishes with its own `done` gets a `completed` mark instead, its signal is not aborted, and it stops being current. When a listener starts a turn while another `startTurn` call is superseding the old one, the listener's call is the later one and its turn becomes current. The earlier call still returns its own turn id, but that turn is closed as `superseded` and is never handed to the adapter. If the adapter's `startTurn` throws, the turn is closed as `cancelled` with cause `adapter_error` before the error reaches the caller, so `activeTurn()` never names a turn that did not start. A `cancel()` from a listener cancels whichever turn is current at that moment. That is nothing if no listener has started a turn, because a turn still being claimed is not current. If an earlier listener has just started a turn, it is that turn.
  - **Four separate marks.** `first_text` (the first chunk with a non-blank character), `first_audio` (the first non-empty audio chunk), `completed` and `cancelled`, each read off a clock the caller passes in. A mark that never happened summarises as `null`, never zero.
  - **Fixture id validation.** A tool event names a fixture id, and an id outside the session's fixture set is dropped as `ungrounded`. The harness does not validate the tool's `output` against the fixture or check facts in text or audio. Anything outside the closed event vocabulary (`text`, `audio`, `tool`, `done`) is dropped as `malformed`.
- `fixtures.mjs` holds two made-up venues labelled "Synthetic Venue", with no price, hours or address, two scripted turns, and a scripted adapter driven by whatever scheduler it is given. Its audio chunks are a few zero bytes, not playable sound.
- `assertLoopbackEndpoint` checks the endpoint a later adapter DECLARES: an explicit port from 1024 to 65535 on `127.0.0.1` or `::1`. `localhost`, `0.0.0.0`, `::` and any other address are refused, and a session refuses an adapter that declares any other endpoint. It is a check on a declaration, not a sandbox: adapter code can still open any connection it likes, and nothing here stops it.

As written, the harness and fixtures import nothing, open no socket, read no microphone, call no provider and download nothing. That describes the source; the tests do not scan for it.

## What the fixture tests show

The tests observe the session through a captured adapter and the `onDeliver` callback. They check stale text, audio, tool results and completions after cancellation, supersession or completion. They also check abort listeners that re-enter the session, current-turn delivery, distinct marks, rejected events and the declared endpoint guard. The clock in the tests is hand-driven, so the figures in them are fixture ticks, not timings. No benchmark figure comes from this harness and none should be quoted from it.

They do not prove that the app never imports the harness or that an adapter's own code stays on loopback. They do not establish model quality, factual grounding, audio playback, latency, privacy or device compatibility.

## What is still needed before any claim about local voice

Each of these is a separate check with its own owner, and the fixture tests stand in for none of them.

- **A real model run.** Speech-to-text, the language model and text-to-speech run locally behind an adapter on an explicit loopback port, by hand, with the model, its licence and its size written down. Only then are first text, first audio and completion readings worth recording, and they are reported with the machine they were measured on.
- **Grounding.** Every venue fact a real model speaks traces back to a tool result from the app's own published data, the same bar the shipped Pal is held to. A fixture id passing here says nothing about a real answer.
- **Privacy.** Where audio and transcripts go, how long they are kept and who can read them is reviewed against the Pal's existing privacy rules before any real voice is recorded.
- **A real device.** Microphone permission, playback, barge-in and interruption are checked on a physical phone. Fixture playback is not device proof.
- **Comparison with the shipped voice.** Any move away from ElevenLabs is its own decision with its own evidence. This harness does not make the case for one.
