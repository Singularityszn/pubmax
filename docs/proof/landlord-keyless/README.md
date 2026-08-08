# Landlord keyless proofs

The Landlord (`/api/heritage`) must fail closed to grounded structured answers
when `OPENROUTER_API_KEY` is unset. It must never invent pub lore.

Authority: `lib/heritage.ts` (`NO_STORY_LINE`, `structuredAnswer`),
`app/api/heritage/route.ts`, `__tests__/heritage.test.ts`.

## Keyless smoke (local or production)

```sh
# Missing / empty OpenRouter: structured facts or the honest no-story line.
curl -sS -X POST "http://localhost:3000/api/heritage" \
  -H "content-type: application/json" \
  -d '{"venueName":"The Churchill Arms"}' | head -c 800
```

Expect JSON with `answer` + `citations`. When no fuller story is on record:

> I've got the basics but no fuller story on record yet. I won't make one up.

## What not to ship

- Unsourced narrative filler
- Client-supplied “context” that forges history (route reconstructs server-side)
- A separate “AI tab” that bypasses retrieval
