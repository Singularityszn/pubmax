# Pal memory eval

How much does Pub Pal remember about the person it is talking to? This suite
answers that in two layers. The first is built and gates CI. The second is
the next step and uses the same personas.

## Layer 1: retrieval (built, gates CI)

What reaches the model. `runMemoryEval.ts` seeds made-up people into the
process-memory stores, then reads each one back through the production code:

- **Typed chat:** `palPersonalContext` (`lib/palElevenLabsChat.server.ts`), the
  exact lines a typed turn puts in the agent's user message.
- **Voice:** `recallPalMemoriesForConversation`, the exact `recall_memories`
  answer, through a real conversation binding.

Each persona in `personas.json` carries:

- `facts`: what the Pal should know. A fact can name the `line` it must sit
  in, so a pub in "rated highest" and the same pub in "rated low" are
  different facts. `must` facts gate the suite. `stretch` facts are measured
  but never gate: they are what the Pal should remember and does not yet.
  `generic` marks a phrase anyone's read may carry (a style, a weekday, a
  vibe), so it is never counted as another person's leak.
- `absent`: what must never reach the model, with the reason (a stale
  rating, an opted-out log, a half pulling the pint price).
- `probes`: a question the person might ask and the facts the Pal needs in
  front of it to answer from memory.
- `exactContext` and `noTasteRead` for the cases that pin the whole context.

Every other persona's non-generic facts, memories and pub names are checked
as leaks too, so one person's memory reaching another fails the suite.

### Scores

| Score | Meaning | Gate |
| :--- | :--- | :--- |
| Must recall | Must facts that reached the model, typed and voice | Must be 1 |
| Leaks | Values that reached the model and must not have | Must be 0 |
| Stretch recall | Stretch facts that reached the model | Tracked. Goes up as memory improves |
| Probes answerable | Probes whose facts all reached the model | Tracked |
| Context size | Characters of personal context per typed turn | Tracked. Cost and latency |

Today stretch recall is 0: recall sends the newest eight confirmed memories
(`PAL_RECALL_MEMORY_LIMIT`), so `long-memory`'s three oldest never reach the
model. When recall picks memories by relevance instead, move those facts to
`must` and update `__tests__/palMemoryEval.test.ts`, which pins the gap.

### Commands

- `npm run eval:pal:memory` runs the suite and writes
  `scoreboard/latest.json` and `latest.md` (git-ignored). It refuses to run
  against Supabase, because seeding is a write, and clears the Supabase keys
  from its own environment first.
- `__tests__/palMemoryEval.test.ts` runs it in `npm run verify` with the
  network off.

### Adding a persona

Use real venue ids from the venue index: the eval resolves names through it
and fails loudly when an id goes missing. Prefer pubs no other persona uses.
Pin every date before `now`. Then check the suite still catches what it
should: break the behaviour your persona is about and watch it fail.

## Layer 2: use (next)

Whether the model actually uses what it was given. It drives the live
ElevenLabs agent in text mode with each persona seeded, asks each probe, and
grades the reply:

- **Use rate:** the reply draws on the probe's facts.
- **False memory:** the reply claims something about the person that was not
  in the context. This must stay at zero.
- **Fit:** a quick pick lands in their usual patch and price.
- **Pick or plan:** questions only when the prompt rule says to ask.

Keeping the two layers apart is the point. When a probe fails in layer 2 but
was answerable in layer 1, the prompt or model is at fault. When it was not
answerable, the gap is storage or retrieval.
