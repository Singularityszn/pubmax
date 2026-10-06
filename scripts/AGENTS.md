# CLIs, harvest, gates and deploys

Rules whose subject is a command: the harvest lanes, the builders and publishers, the quality gates and the deploy scripts.

Repo-wide laws and the index of every other area file are in the root [AGENTS.md](../AGENTS.md).

Long-form incident history, measured proof and review finding IDs live under [`docs/rules/`](../docs/rules/). Each line below names one invariant and links to its full rule. Write or change a rule in its detail file, and keep its title line here in step.

## CI, gates and audits

Full rules: [`docs/rules/scripts-ci-gates-and-audits.md`](../docs/rules/scripts-ci-gates-and-audits.md).

- [CI RUNNER CONFIGURATION HAS ONE OWNER, AND A BUILD IS NOT A PRODUCTION RUNTIME.](../docs/rules/scripts-ci-gates-and-audits.md#every-job-runs-on-the-avrea-label-and-a-build-is-not-a-production-runtime)
- [KNIP IS THE DEAD-CODE GATE, AND EVERY IGNORE NAMES THE CALLER KNIP CANNOT SEE.](../docs/rules/scripts-ci-gates-and-audits.md#knip-is-the-dead-code-gate-and-every-ignore-names-the-caller-knip-cannot-see)
- [A GENERATED LANE MAY RIDE THE REVIEW THAT PRODUCED IT, AND NOTHING ELSE MAY.](../docs/rules/scripts-ci-gates-and-audits.md#a-generated-lane-may-ride-the-review-that-produced-it-and-nothing-else-may)
- [EVERY GATE IS RUN BY SOMETHING, AND A REPORT-GATE RUNS WHERE THE REPORT IS.](../docs/rules/scripts-ci-gates-and-audits.md#every-gate-is-run-by-something-and-a-report-gate-runs-where-the-report-is)
- [An audit waiver is a documented exception, not a mute button.](../docs/rules/scripts-ci-gates-and-audits.md#an-audit-waiver-is-a-documented-exception-not-a-mute-button)
- [The no-mistakes Test step runs `npm run verify:no-mistakes` as its own command.](../docs/rules/scripts-ci-gates-and-audits.md#the-no-mistakes-test-step-runs-npm-run-verify-as-its-own-command)
- [Generated database types are cut from the harness cluster, and verify refuses drift.](../docs/rules/scripts-ci-gates-and-audits.md#generated-database-types-are-cut-from-the-harness-cluster-and-verify-refuses-drift)

## Harvest and source permission

Full rules: [`docs/rules/scripts-harvest-and-source-permission.md`](../docs/rules/scripts-harvest-and-source-permission.md).

- [The all-UK pub harvest enumerates OSM then enriches via Exa.](../docs/rules/scripts-harvest-and-source-permission.md#the-all-uk-pub-harvest-enumerates-osm-then-enriches-via-exa)
- [A MENU URL THE FOLD RECORDED IS A CRAWL INPUT, AND THE TABLE IS EMPTY.](../docs/rules/scripts-harvest-and-source-permission.md#a-menu-url-the-fold-recorded-is-a-crawl-input-and-the-table-is-empty)
- [A URL WE DECIDE TO FETCH IS SOMEBODY ELSE'S STRING, AND THE ALLOW-LIST IS ASKED ABOUT WHERE WE LANDED.](../docs/rules/scripts-harvest-and-source-permission.md#a-url-we-decide-to-fetch-is-somebody-else-s-string-and-the-allow-list-is-asked-a)
- [A PRICE source is fenced like every other source, and the NARROWER table binds.](../docs/rules/scripts-harvest-and-source-permission.md#a-price-source-is-fenced-like-every-other-source-and-the-narrower-table-binds)
- [The London harvest reads first-party pages, and a skip is a finding.](../docs/rules/scripts-harvest-and-source-permission.md#the-london-harvest-reads-first-party-pages-and-a-skip-is-a-finding)
- [THE WETHERSPOON DIRECTORY IS THE PUBS THE CHAIN RUNS TODAY, AND IT IS NEVER EDITED BY HAND.](../docs/rules/scripts-harvest-and-source-permission.md#the-wetherspoon-directory-is-the-pubs-the-chain-runs-today-and-it-is-never-edite)
- [The UK venue extraction is OSM-stated or it does not exist, save one London restaurant lane.](../docs/rules/scripts-harvest-and-source-permission.md#the-uk-venue-extraction-is-osm-stated-or-it-does-not-exist-save-one-london-resta)
- [The nightly Tavily pass spends the plan and writes Listed evidence only.](../docs/rules/scripts-harvest-and-source-permission.md#the-nightly-tavily-pass-spends-the-plan-and-writes-listed-evidence-only)
- [The London Tavily pass and the London promotion are capped in code, and every row keeps its evidence.](../docs/rules/scripts-harvest-and-source-permission.md#the-london-tavily-pass-and-the-london-promotion-are-capped-in-code)

## Builders and publishers

Full rules: [`docs/rules/scripts-builders-and-publishers.md`](../docs/rules/scripts-builders-and-publishers.md).

- [THE HYPED-PUBS PUBLISH IS ONE COMMAND, AND IT FETCHES NOTHING.](../docs/rules/scripts-builders-and-publishers.md#the-hyped-pubs-publish-is-one-command-and-it-fetches-nothing)
- [The Pint Index PUBLISHES what drinkers confirmed, and the producer is a script.](../docs/rules/scripts-builders-and-publishers.md#the-pint-index-publishes-what-drinkers-confirmed-and-the-producer-is-a-script)
- [A SLIM REBUILD THAT DROPS A SHIPPED FAMOUS VENUE FAILS.](../docs/rules/scripts-builders-and-publishers.md#a-slim-rebuild-that-drops-a-shipped-famous-venue-fails)
- [THE HISTORIC DIRECTORY PUBLISHES THROUGH THREE GATES, AND EACH ONE REFUSES RATHER THAN REWRITES.](../docs/rules/scripts-builders-and-publishers.md#the-historic-directory-publishes-through-three-gates-and-each-one-refuses-rather)

## Deploys and uploads

Full rules: [`docs/rules/scripts-deploys-and-uploads.md`](../docs/rules/scripts-deploys-and-uploads.md).

- [A `.vercelignore` REPLACES the `.gitignore` fallback, so a heavy directory absent from it is uploaded.](../docs/rules/scripts-deploys-and-uploads.md#a-vercelignore-replaces-the-gitignore-fallback-so-a-heavy-directory-absent-from-)
- [A DEPLOY UPLOADS THE WORKING TREE, NOT THE COMMIT, so `.vercelignore` is what keeps it small.](../docs/rules/scripts-deploys-and-uploads.md#a-deploy-uploads-the-working-tree-not-the-commit-so-vercelignore-is-what-keeps-i)
- [A DEPLOY NAMES ITS OWN COMMIT, AND A CLI DEPLOY HAS TO CARRY IT.](../docs/rules/scripts-deploys-and-uploads.md#a-deploy-names-its-own-commit-and-a-cli-deploy-has-to-carry-it)
- [A PRODUCTION RELEASE IS ONE COMMAND, AND IT ENDS AT THE SMOKE VERDICT.](../docs/rules/scripts-deploys-and-uploads.md#a-production-release-is-one-command-and-it-ends-at-the-smoke-verdict)
