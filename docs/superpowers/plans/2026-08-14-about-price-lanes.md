# About price-lane totals plan

**Goal:** Publish exact price-source totals so nobody can mistake Venue Dataset rows for drinker submissions.

**Architecture:** Extend the existing pure About stats model with exact-price publisher recorded and publisher not recorded counts. Read the current corroborated community map-authority count through its existing server seam. Render each as a separate lane. A degraded community read says it could not be read and never prints zero as fact.

## RED

1. About stats split every usable Venue Dataset Pint Price into publisher recorded or publisher not recorded.
2. The two source-status counts sum to the existing total.
3. About renders Venue Dataset and Community map authority as separate lanes.
4. Community truncation prints a floor. Degraded read prints no count.

## GREEN

Modify `lib/aboutStats.ts`, `app/about/page.tsx`, and `app/about/about.css`. Keep all counts derived from existing governed reads. Add no marketing estimate and no user claim.

## Verify

Run About unit/render tests, voice fences, ESLint, TypeScript, and 390px browser geometry.
