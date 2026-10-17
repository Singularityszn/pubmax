# Pal memory eval

How much does Pub Pal remember about the person it is talking to? This suite
answers that in two layers over the same personas. Layer 1 grades what
reaches the model and gates CI. Layer 2 grades what the live model does with
it and runs on demand.

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
  front of it to answer from memory. Layer 2 also reads its `mode` (`answer`
  or `ask`) and `minUsed`, and each fact's `aliases`, the shorter ways a
  reply may say it.
- `exactContext` and `noTasteRead` for the cases that pin the whole context.

Every other persona's non-generic facts, memories and pub names are checked
as leaks too, so one person's memory reaching another fails the suite.

### Scores

| Score | Meaning | Gate |
| :--- | :--- | :--- |
| Must recall | Must facts that reached the model, typed and voice | Must be 1 |
| Leaks | Values that reached the model and must not have | Must be 0 |
| Stretch recall | Stretch facts that reached the model | Tracked. Goes up as memory improves |
| Probes answerable | Probes whose facts all reached the model, with the context built for that probe's ask | Must be every probe |
| Context size | Characters of personal context per typed turn | Tracked. Cost and latency |

Recall carries every confirmed memory up to forty, ranked by the ask
(`lib/palMemoryRelevance.ts`), so each probe is judged against the context
built for its own words, and every probe must be answerable: that is part of
the gate. Persona-level facts are judged against a turn with no ask.

- `long-memory` has eleven memories, fewer than a turn carries, so all eleven
  are `must` on every turn.
- `vast-memory` has forty-five. Its wheelchair need is the oldest and is
  `must` on every turn, because access needs are pinned. Four other old
  memories are `stretch` on a turn with no ask, since forty newer ones fill
  it, and its probes require each of them when the ask is about it.

History: the first run, with recall sending the newest eight, had 14 of 17
probes answerable. Ranking by the ask took it to 17 of 17, and carrying up
to forty made all eleven of `long-memory`'s memories reach every turn.
Restoring the old cap fails `long-memory`; switching off the ranking fails
all four `vast-memory` probes.

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

## Layer 2: use (built, runs live on demand)

What the model does with it. `runMemoryUseEval.ts` seeds the same personas
and asks every probe through a responder, one fresh conversation per probe,
so all a reply can know about the person is what the server sends from their
stores. The live responder is the production typed turn
(`runPalElevenLabsChatTurn`) against the agent in
`ELEVENLABS_PUB_PAL_AGENT_ID`. Memory and taste are read locally from the
seeded stores. Factual tools run on the deployed app the agent's webhooks
point at, so their cards stay there and the grade reads the reply text.

Each reply is graded on:

| Score | Meaning | Gate |
| :--- | :--- | :--- |
| False memories | A sentence that tells the person something about themselves ("you usually", "your local", "last time you") and cites another person's data, an opted-out log or a stale rating, or any such claim when the Pal has nothing on record for them | Must be 0 |
| Failed turns | A turn that errored or timed out. Counted, never skipped | Must be 0 |
| Use rate | Needed facts the reply said, by value or alias | Tracked |
| Answer or ask | `answer` probes get an answer, not only questions. `ask` probes get one to three questions | Tracked |
| Blame | A miss whose facts reached the model is the model's. One whose facts never did is retrieval's | Tracked |
| Latency | p50 and p95 per typed turn | Tracked |

A pub named in a pick is never a false memory on its own: it may be a tool
result. Only a claim about the person counts. A value barred from one line
only (`absent` with a `line`) counts when the claim puts it on that line:
"you loved BrewDog Shoreditch" is the stale rating, "you rated it low" is not. The grader is deterministic, so
it cannot catch every invented memory; every reply is written to the
scoreboard for a person to read.

### Commands

- `npm run eval:pal:memory:live` runs layer 1, then layer 2 against the live
  agent, and writes `scoreboard/use-latest.json` and `use-latest.md`. It
  needs `ELEVENLABS_API_KEY` and `ELEVENLABS_PUB_PAL_AGENT_ID`, refuses
  without them and sends nothing, and spends one typed turn per probe. It
  exits 1 on a false memory or a failed turn.
- `__tests__/palMemoryUseEval.test.ts` tests the grader with scripted
  responders in `npm run verify`: an honest Pal passes and its one miss is
  laid on retrieval, and invented claims, dodged picks and failed turns all
  fail.

Keeping the two layers apart is the point. When a probe fails in layer 2 but
was answerable in layer 1, the prompt or model is at fault. When it was not
answerable, the gap is storage or retrieval.
