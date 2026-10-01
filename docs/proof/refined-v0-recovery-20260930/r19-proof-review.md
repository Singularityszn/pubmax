# R19 proof review

One wording correction is actionable.

- `docs/proof/refined-v0-recovery-20260930/README.md:168` calls the observed ~600 ms before Inspector requests begin “serialization.” Raw later-run timing is about 601–616 ms from API resource start to response end; the analysis breaks this into 337–347 ms before request start, 2.0–2.5 ms to response start, and 259–267 ms body transfer. First-run server interval is 121.7 ms. Name this the browser-observed API request interval, not server serialization. The separate “roughly two seconds” describes Inspector resource completion after its requests start; README already says overlap does not guarantee that much LCP improvement, so it does not claim a two-second LCP gain.

No other actionable mismatch found: all three diagnostic JSONs contain five interacted samples with finite, non-negative metrics; the observer-free Home reference is separated from attributed diagnostics, and the failed strict R18 default-five CWV result remains authoritative. Selected-venue price is explicitly labeled estimated, not listed. README’s 84 relative links resolve. The archived `.txt` driver has no references from package scripts, test suites, or CI configuration; it does import Playwright and `e2e/helpers/webVitals.ts` when manually run, which does not make it an automatic build/test input.
