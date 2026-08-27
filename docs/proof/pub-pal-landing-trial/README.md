# Pub Pal landing trial proof

## Scope

- Pal-first landing at 390 by 844 and 1440 by 900.
- Seven-form companion choice with Talk and Text entry.
- Five successful signed-out answers followed by account creation.
- Selected companion remains visible in chat.

## Files

- `landing-mobile-390.png`
- `landing-desktop-1440.png`

## Reproduce

```bash
npx playwright test e2e/pub-pal-landing-trial.spec.ts --workers=1
```

Screenshots use the keyless grounded `/api/ask` contract. The five-answer test
intercepts that route with deterministic empty-but-grounded answers and asserts
that no sixth request is made.
