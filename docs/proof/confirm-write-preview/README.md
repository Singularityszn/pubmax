# Confirm write preview proof (P0)

The no-mistakes PR step should copy the **Pull request body** section below into the GitHub PR for `fm/pubmax-confirm-write-preview`.

## Pull request body

## Summary

Prove Confirm write behaviour with local PostgreSQL RLS and route handlers: a matching second drinker sets `pintTrust` to `confirmed`, a mismatching figure leaves `disputed`, and anonymous callers get 401 with no table insert. Updates `__tests__/permissionMatrixEffective.test.ts` and the Confirmation row in `docs/security/PERMISSION_MATRIX.md`.

**Signed-in Vercel preview is not used for this proof.** Preview builds for project `chengdu` inline the production Supabase project `iankajxliutqogqkmvdg`, so a true signed-in preview Confirm would write to production data. The accepted contract is the local permission-matrix suite (same RLS semantics, no preview or pubmaxxing.com calls).

**No Confirm was pressed anywhere** in preview, production, or Supabase during this task.

## Test plan

- [ ] `npx vitest run __tests__/permissionMatrixEffective.test.ts -t "price observation and its confirmation"`
- [ ] `npm run verify:no-mistakes` (no-mistakes gate)

### Local Confirm proof (accepted P0 contract)

- Anonymous `POST /api/price-submit` returns 401; `anon` and `authenticated` roles cannot insert into `public.pint_drops`.
- Alice first report: `awaiting_second_drinker`, `pintTrust` `logged-once`.
- Alice second figure (4.6 vs 4.5): `price_disagrees`, `pintTrust` `disputed`, not `confirmed`.
- Bob matching confirm (4.5): `confirmed`, both rows share one `confirmation_id`.

### Read-only browser pass (signed out, no writes)

Preview URL: `https://chengdu-hhny7abh0-pubmax69.vercel.app/map?sel=venue-1vle947` (The Sir Christopher Hatton, `venue-1vle947`).

| Viewport | Size |
| --- | --- |
| Desktop | 1280×800 |
| Phone | 390×844 |

Observed sheet copy: “Which did you pay?” with £4.50 and £4.70, and “Two drinkers, two prices: £4.50 and £4.70”. **Neither Confirm button was clicked.**

Network on load (writes): GET only for `https://iankajxliutqogqkmvdg.supabase.co/auth/v1/settings` (200) and `/api/pint-drops?city=london` (200). **No price POST.**

Console: only CSP blocking `https://vercel.live/_next-live/feedback/feedback.js` on the preview.

Screenshots in this directory:

- `desktop-door.png` (desktop)
- `phone-door.png` (phone)

## Security checklist

- [x] No new write paths; test-only and documentation
- [x] No secrets in repo
- [x] No production Supabase writes or live Confirm in this change
