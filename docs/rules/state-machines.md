# How to write a state machine here

A cross-area rule for `lib/`, `components/`, `app/` and `supabase/`. The area traps in [`lib/AGENTS.md`](../../lib/AGENTS.md) and [`supabase/AGENTS.md`](../../supabase/AGENTS.md) point here.

## When this rule applies

Use a state machine when a value has three or more states. Also use one when two or more flags change together, when a status column exists, or when a flow has an `await` between its steps.

## Where it lives

- Put one machine in one module under `lib/`. Name it for the thing it models, for example the Pint Drop submission.
- The module is a policy leaf. It imports types only, never a store or a React module.
- Hooks, routes and stores import the machine. The machine never imports them.

## The shape

```ts
export type SubmissionState =
  | { phase: "idle" }
  | { phase: "posting"; requestId: string; accountRevision: number }
  | { phase: "failed"; requestId: string; message: string; canRetry: boolean }
  | { phase: "saved"; requestId: string; dropId: string };

export type SubmissionEvent =
  | { type: "submit"; requestId: string; accountRevision: number }
  | { type: "succeeded"; requestId: string; accountRevision: number; dropId: string }
  | { type: "failed"; requestId: string; accountRevision: number; message: string; canRetry: boolean }
  | { type: "account_changed"; accountRevision: number };

export function transitionSubmission(state: SubmissionState, event: SubmissionEvent): SubmissionState {
  switch (event.type) {
    case "submit":
      return { phase: "posting", requestId: event.requestId, accountRevision: event.accountRevision };
    case "succeeded":
    case "failed":
      // A response for another attempt or another account changes nothing.
      if (state.phase !== "posting" || state.requestId !== event.requestId || state.accountRevision !== event.accountRevision) return state;
      return event.type === "succeeded"
        ? { phase: "saved", requestId: event.requestId, dropId: event.dropId }
        : { phase: "failed", requestId: event.requestId, message: event.message, canRetry: event.canRetry };
    case "account_changed":
      return state.phase === "posting" && state.accountRevision !== event.accountRevision ? { phase: "idle" } : state;
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}
```

## The rules

1. **States are a union with a literal tag.** Data that exists in one state lives inside that state. Never pair a value with a separate flag that says how to read it, as `feedback` and `feedbackIsStatus` do.
2. **Store source values only.** A value you can compute from others is a function, for example `canLock(state)`. It is not a `useState` and not a storage key.
3. **One pure transition function.** It does no fetch, storage, timers or `Date.now()`. Pass the time in the event. When it must ask for an effect, return `{ state, effect }`, as `lib/mapDataPackFailure.ts` does.
4. **Exhaustive switches.** End every switch over a union with `const unreachable: never = x`. `tsc` then names every site when a state is added.
5. **Scope fencing.** An event that ends an `await` carries its scope: account revision, plan id, venue id or conversation id. The function returns the old state when the scope is stale. Precedent: `contributionGateReducer` in `components/identity/ContributionGateDialog.tsx`.
6. **A refused event returns the same object.** React then skips the render, and a test can assert `toBe(state)`.
7. **Effects stay in the hook or the route.** They turn results into events. They never call a raw `setX` for the machine's state.
8. **Idempotency keys belong to the attempt.** Mint the key once when the attempt starts. Rotate it only when the payload changes. Send it on every retry. Precedent: the draft's `requestKey` in `app/social/SocialComposer.tsx`.
9. **Storage and URL.**
   - Persist a machine through one versioned serialiser.
   - A key that holds account data is account-scoped, or it is in `DEVICE_IDENTITY_LOCAL_KEYS` or `DEVICE_IDENTITY_SESSION_KEYS` (`lib/deviceAccountIdentity.ts`).
   - A URL param is either the source or derived. It has one writer.
   - Every stored state value has a writer and a reader. Delete a value or a key that only one side uses.
10. **Server stores.** The memory and Supabase backends import the same transition table. A Supabase write is compare-and-set on the from-state (`.in("state", allowedFrom)`). Zero rows means `conflict`, never success. Precedent: `nextState` and `setState` in `lib/pintDropWithTagsStore.ts`.
    `npm run lint` enforces one owner module for lifecycle writes through `status-writer/one-writer`. [The lint rule](../../lib/statusWriterFence.mjs) owns the table registry and the checked syntax. [The ESLint configuration](../../eslint.config.mjs) also checks that each owner file exists.
11. **Database.**
    - Every status column has a value CHECK.
    - A timestamp that follows a status has a pair CHECK. Count production violations read-only before applying the migration. Add it `NOT VALID`, then `VALIDATE`.
    - A lifecycle with more than one writer (several routes, a cron job, a trigger) changes state only through a guarded security definer RPC that checks the from-state and the expected revision.
    - When SQL copies a TS table, a PostgreSQL-harness parity test holds them equal.
12. **Tests.**
    - One table test for the transition function. It covers each accepted `(state, event)` pair, and each important refusal returns the same object.
    - Before you refactor an existing machine, add characterisation tests that pin today's behaviour, defects included, and keep them green.
    - Prove SQL on the PostgreSQL harness (`__tests__/*Effective.test.ts`).
    - Never read source or SQL as text. Never sleep. Wait for the event.
13. **Size.** Keep a machine module under about 300 lines. Split a larger one by sub-state, for example the composer's request, route and activity.
14. **XState is not used here.** It adds about 43 KB of decoded JavaScript per route, and the pattern above already covers the need. Raise it with the captain before you add it.
