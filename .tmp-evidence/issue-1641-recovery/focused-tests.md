# Issue 1641 recovery evidence

Base: `origin/main` at `cbfd9701721c5d09f67cf3b2e7561f206619e29d`.
Recovered commit: `0b767bcb92d17fafdec165fc177c8cc61be9dc66`.
Source commit: `05fdc824851ec9f72175fa8e58ae69941f960aeb`.
Branch: `codex/issue-1641-recovery`.

The cherry-pick had one `lib/mapWarmup.ts` conflict where the source commit's
old context included `warmMapIntent()`. Resolution retained origin/main's
removal of that unrelated helper and added only the required 128-entry bound.
No other removed exports were restored.

## Focused test run

Command:

```text
npm test -- __tests__/mapWarmup.test.ts __tests__/intentLinkWarming.test.tsx
```

Exact result:

```text
> pubmaxxing@0.1.0 test
> vitest run __tests__/mapWarmup.test.ts __tests__/intentLinkWarming.test.tsx

 RUN  v5.0.1 /Users/karanmanoharan/.codex/worktrees/pubmaxx-issue-1641-recovery

 Test Files  2 passed (2)
      Tests  27 passed (27)
   Start at  06:53:35
   Duration  2.02s (environment 62%, transform 23%, tests 8%, import 4%, setup 2%, worker 1%)
```

`git show --check` passed. No full verification or browser run was performed in
this recovery task.
