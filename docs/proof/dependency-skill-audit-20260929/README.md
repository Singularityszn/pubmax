# Dependency and skill maintenance - 29 September 2026

18 direct dependency upgrades installed. Initial 17-upgrade candidate passed local `npm run verify`; Context.dev 3.3 then passed focused regression tests, lint and typecheck. Fresh committed-lock installation, committed-data verification and isolated production build passed. All 69 direct installed versions match the committed lock. Independent final-head review remains pending.

Publication receipts: [package versions and checks](package-receipt.json), [all 69 direct lock comparisons](direct-lock-receipt.json), [skill discovery and runtime](runtime-receipt.json). Raw logs, global skill listings, manager manifests and backup paths remain local and are excluded by this folder's explicit allowlist.

## Packages

Official npm metadata refreshed all 69 direct dependencies. Eighteen of 19 available upgrades were selected. TypeScript stays at 5.9.3 because parser 8.71.0 requires TypeScript `>=4.8.4 <6.1.0`; latest 7.0.2 exceeds that peer range. No peer dependency override was forced.

Next.js, its environment package and ESLint configuration moved together to 16.3.7. Vitest, coverage and browser adapter moved together to 5.0.2. AI and telemetry retain exact 7.0.122 and 1.0.122 pins used by PR #1873. Unselected ESLint, jsdom and tsx manifest ranges remain `^10.10.0`, `^30.1.0` and `^4.23.13`; their locks preserve baseline versions 10.11.0, 30.1.1 and 4.23.15. Fresh `npm ci` exited zero, and a direct file comparison confirmed all 69 installed direct versions match their committed lock versions.

Context.dev is pinned at 3.3.0. Migration reuses two consumers, five tests and three docs from PR #1873 head `76f46cca00d879d4d9ba21b5caa263988109b7a0`; its UI, e2e and package changes are excluded. SDK 3.3 retains 3.2 scrape and URL-map transport, adds optional failed-output metadata and search highlights, and changes vendor cache defaults. Extraction requests JSON and Markdown in one fresh scrape with `maxAgeMs: 0`, rejects partial or incomplete captures, and grounds events in supported records from that capture. Optional price reads already set an explicit cache age.

With SDK 3.3 installed and old consumers retained, two transport suites reproduced 30 failures among 46 tests, including removed SDK methods. After migration, five suites passed all 147 tests. Changed-path ESLint and whole-application TypeScript checks exited zero.

Initial 17-upgrade verify passed 1,695 coverage files and 17,968 tests, with one file and five tests skipped. Separate shared-memory checks passed nine tests per run; RLS passed 421 tests. Freshness reported one advisory stale dataset and three unmeasurable durable feeds. Resilient audit reported no high or critical vulnerabilities. Generated data churn was restored. This gate preceded Context.dev changes and does not validate the final candidate.

Final `npm run verify:no-mistakes` exited zero after all 18 upgrades and the Context.dev migration. Coverage passed 1,695 files and 18,055 tests, with one file and five tests skipped; RLS passed 421 tests and both shared-memory checks passed nine each. Coverage: statements 82.57%, branches 75.65%, functions 87.35%, lines 86.44%. Freshness and audit outcomes remained as above. Isolated Next.js 16.3.7 production build exited zero; the existing wrapper restored tracked data and Next environment files. No PUBMAXX browser check ran in this lane. A subsequent review found that these checks used local ESLint 10.10.0, jsdom 30.1.0 and tsx 4.23.13 instead of the three preserved lock versions above. All 18 selected upgrade targets matched their locks. That first result therefore remains local-tree evidence only. Fresh `npm ci` then restored all 69 direct packages to exact committed-lock versions. The subsequent full verification and isolated production build both exited zero with the same test counts and coverage figures. The all-package comparison and final exits are recorded in the publication receipts.

Parent coordinates integration with open PRs #1860, #1873 and #1876. No push, PR, deployment or shared database migration ran in this lane. Parent owns publication.

## Skills and runtime

15 stock shared packs updated to exact upstream folder hashes and manager entries. Six customized packs and four moved or missing upstream packs were preserved. Other manager entries stayed unchanged; the registry retains 200 entries. Original packs, links and registry remain backed up with restore manifests. Individual restoration requires checking later edits first.

26 broken gstack aliases repaired from [upstream commit 943105f](https://github.com/garrytan/gstack/tree/943105f1099c058b34c4bffb9ed78730b856bbef), version 1.91.8. All 185 installed files and executable modes match upstream; shared broken links fell from 26 to zero. Only directories named by broken aliases were installed. No broad skill registration ran.

Native Codex CLI 0.158.0 app-server discovery parsed 1,206 entries with zero errors. All 26 repaired packs and all 15 updated shared packs appeared. Discovery proves parsing and availability, not execution of every skill.

Official frozen Bun installation and build exited zero. Browser, design, PDF and CSO tools built. Official setup did not run; only the previously absent gstack runtime link was added. Existing settings, hooks, manager lock and 2,579 regular shared skill files had zero hash changes.

Actual browser smoke used a disposable loopback fixture and isolated daemon state. Navigation returned 200, a button click changed output, health was healthy and stop exited zero. All six commands exited zero. Browser installation used an isolated cache; shared cache stayed unchanged. This proves fixture browser operation, not PUBMAXX UI behavior. Design generation, PDF extraction and CSO scans were not exercised.

Official generation warned that unregistered Hermes and GBrain ship prompts exceed upstream token ceilings. Those generated hosts were not registered. Fresh npm metadata confirmed skills CLI 1.7.0, gh-axi 0.1.35 and chrome-devtools-axi 0.1.35 as current; no replacement was needed.
